"""
Simulates the EC2 release flow (deploy/ec2/deploy.sh and rollback.sh) in a temporary directory.
Nothing touches AWS: "systemctl" is a stand-in that starts and stops uvicorn directly, and the
database is a disposable PostgreSQL whose name must contain "test" (it is migrated by the deploy).

    RELEASE_TEST_DATABASE_URL=postgresql+psycopg2://user:pass@localhost/itam_release_test \
        .venv/bin/python scripts/release_flow_test.py

Checks: first deploy, a second deploy keeps the first, rollback.sh, a release that does not become
healthy rolls itself back, an unsafe configuration is refused before anything changes, the
configuration stays outside the release, and logs carry no secrets.
"""
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..")
REPO = os.path.join(BACKEND, "..")
sys.path.insert(0, HERE)
URL = os.environ.get("RELEASE_TEST_DATABASE_URL")
if not URL:
    raise SystemExit(__doc__)
from _dbguard import require_disposable  # noqa: E402

require_disposable(URL, "RELEASE_TEST_DATABASE_URL")
RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  -> {detail}"))


with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    PORT = s.getsockname()[1]
ROOT = tempfile.mkdtemp(prefix="itam-ec2-")
APP, RELEASES = os.path.join(ROOT, "itam"), os.path.join(ROOT, "itam-releases")
os.makedirs(APP)
# Reuse this Python environment (everything is already installed, so pip has nothing to download).
os.makedirs(os.path.join(APP, "venv", "bin"))
for _name, _body in (("python", f'exec "{sys.executable}" "$@"'), ("pip", f'exec "{sys.executable}" -m pip "$@"')):
    _path = os.path.join(APP, "venv", "bin", _name)
    open(_path, "w").write("#!/usr/bin/env bash\n" + _body + "\n")
    os.chmod(_path, 0o755)
ENV_FILE = os.path.join(ROOT, "itam.env")
JWT = "release-flow-secret-0123456789abcdef0123456789abcd"
PASSWORD = "A-long-seed-password-1"
ORIGIN_SECRET = "rf" + "Mn6" * 15
GOOD_ENV = f"""ENVIRONMENT=production
DATABASE_URL={URL}
JWT_SECRET={JWT}
ORIGIN_VERIFY_SECRET={ORIGIN_SECRET}
CORS_ORIGINS=https://itam.example.com
SEED_SUPER_ADMIN_EMAIL=root@itam.example.com
SEED_SUPER_ADMIN_PASSWORD={PASSWORD}
"""
open(ENV_FILE, "w").write(GOOD_ENV)
os.chmod(ENV_FILE, 0o600)

# Stand-in for systemctl: "restart" stops any running API and starts the one in current/ (as the unit would).
STUB = os.path.join(ROOT, "stubctl")
LOG = os.path.join(ROOT, "service.log")
open(STUB, "w").write(f"""#!/usr/bin/env bash
PIDFILE="{ROOT}/pid"
if [ -f "$PIDFILE" ]; then kill -TERM "$(cat $PIDFILE)" 2>/dev/null; sleep 1; kill -9 "$(cat $PIDFILE)" 2>/dev/null; rm -f "$PIDFILE"; fi
[ "$1" = "stop" ] && exit 0
cd "{APP}/current/backend" || exit 1
set -a; . "{ENV_FILE}"; set +a
nohup "{sys.executable}" -m uvicorn app.main:app --host 127.0.0.1 --port {PORT} --workers 1 --no-proxy-headers >> "{LOG}" 2>&1 &
echo $! > "$PIDFILE"
""")
os.chmod(STUB, 0o755)
ENV = {**os.environ, "ITAM_ROOT": ROOT, "ITAM_ENV_FILE": ENV_FILE, "SYSTEMCTL": STUB, "PYTHON": sys.executable,
       "ITAM_HEALTH_URL": f"http://127.0.0.1:{PORT}/api/health/ready", "ITAM_HEALTH_TRIES": "20"}
ENV.pop("DATABASE_URL", None)
ENV.pop("JWT_SECRET", None)


def make_tarball(name, broken=False):
    path = os.path.join(ROOT, name)
    with tarfile.open(path, "w:gz") as tar:
        def keep(info):
            skip = ("__pycache__", ".venv", ".pyc", ".log", ".pgcheck")
            return None if any(part in info.name for part in skip) else info
        tar.add(BACKEND, arcname="backend", filter=keep)
    if broken:  # a release whose application cannot start
        broken_dir = tempfile.mkdtemp()
        with tarfile.open(path) as tar:
            tar.extractall(broken_dir)
        with open(os.path.join(broken_dir, "backend", "app", "main.py"), "a") as handle:
            handle.write("\nraise RuntimeError('deliberately broken release')\n")
        os.remove(path)
        with tarfile.open(path, "w:gz") as tar:
            tar.add(os.path.join(broken_dir, "backend"), arcname="backend")
        shutil.rmtree(broken_dir)
    return path


def run(script, *args):
    return subprocess.run([os.path.join(REPO, "deploy", "ec2", script), *args], env=ENV, capture_output=True, text=True, timeout=300)


def current():
    link = os.path.join(APP, "current")
    return os.path.basename(os.readlink(link)) if os.path.islink(link) else None


def healthy():
    try:
        return urllib.request.urlopen(ENV["ITAM_HEALTH_URL"], timeout=2).status == 200
    except Exception:
        return False


def login(origin=True):
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/auth/login", method="POST",
                                     data=json.dumps({"email": "root@itam.example.com", "password": PASSWORD}).encode(),
                                     headers={"Content-Type": "application/json", **({"X-Origin-Verify": ORIGIN_SECRET} if origin else {})})
    try:
        return urllib.request.urlopen(request, timeout=5).status
    except Exception as error:
        return getattr(error, "code", str(error))


try:
    print("First deploy")
    first = run("deploy.sh", make_tarball("r1.tgz"))
    check("deploy.sh succeeds on a fresh server", first.returncode == 0, first.stdout[-300:] + first.stderr[-500:])
    release1 = current()
    check("current points at the new release directory", release1 and os.path.isdir(os.path.join(RELEASES, release1, "backend")), release1)
    check("the API is healthy after the deploy", healthy())
    check("migrations ran and the seeded Super Admin signs in (independent authentication)", login() == 200, login())
    check("the configuration file lives outside the release", not any(f.endswith(".env") for f in os.listdir(os.path.join(RELEASES, release1, "backend"))))
    check("the deploy printed no secrets", all(x not in first.stdout + first.stderr for x in (JWT, PASSWORD, ORIGIN_SECRET)))
    check("with ORIGIN_VERIFY_SECRET set, the deploy's own health check still works (health stays open)", healthy())
    check("and a sign-in that skips the CloudFront header is refused (403)", login(origin=False) == 403, login(origin=False))

    print("Second deploy and rollback")
    time.sleep(1.1)  # release ids are timestamps
    second = run("deploy.sh", make_tarball("r2.tgz"))
    release2 = current()
    check("a second deploy succeeds and switches current", second.returncode == 0 and release2 != release1, second.stdout[-200:] + second.stderr[-300:])
    check("the first release is kept for rollback", os.path.isdir(os.path.join(RELEASES, release1)))
    back = run("rollback.sh")
    check("rollback.sh returns to the previous release and it is healthy", back.returncode == 0 and current() == release1 and healthy(),
          (back.stdout + back.stderr)[-300:])

    print("A release that does not start rolls itself back")
    time.sleep(1.1)
    env_backup = dict(ENV)
    ENV["ITAM_HEALTH_TRIES"] = "8"
    bad = run("deploy.sh", make_tarball("r3.tgz", broken=True))
    ENV.update(env_backup)
    check("deploy.sh reports failure (exit 5)", bad.returncode == 5, (bad.returncode, bad.stderr[-300:]))
    check("current is back on the last good release", current() == release1, current())
    check("and the service is healthy again", healthy())

    print("An unsafe configuration is refused before anything changes")
    open(ENV_FILE, "w").write(GOOD_ENV.replace(JWT, "short"))
    before = current()
    time.sleep(1.1)
    refused = run("deploy.sh", make_tarball("r4.tgz"))
    check("deploy.sh stops with exit 3 and says the configuration was refused",
          refused.returncode == 3 and "Unsafe production configuration" in refused.stdout + refused.stderr, (refused.returncode, refused.stderr[-300:]))
    check("current did not move and the old release is still serving", current() == before and healthy())
    check("the error does not repeat the database password", URL.split(":")[2].split("@")[0] not in refused.stdout + refused.stderr)
    open(ENV_FILE, "w").write(GOOD_ENV)

    print("Graceful stop")
    subprocess.run([STUB, "stop"], env=ENV)
    time.sleep(1.5)
    log = open(LOG).read()
    check("shutdown was logged by the API", "ITAM API shutting down" in log, log[-200:])
    check("service logs carry no JWT secret, origin secret or Super Admin password", JWT not in log and PASSWORD not in log and ORIGIN_SECRET not in log)
finally:
    subprocess.run([STUB, "stop"], env=ENV)
    shutil.rmtree(ROOT, ignore_errors=True)

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
sys.exit(0 if all(RESULTS) else 1)
