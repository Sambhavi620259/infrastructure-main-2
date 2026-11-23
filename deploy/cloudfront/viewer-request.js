// CloudFront Function (runtime cloudfront-js-2.0), event type: viewer-request, attached to the DEFAULT (static) behaviour only.
//
// The static build writes /tickets.html, /users/new.html and so on, and one placeholder page per detail route
// (/tickets/_.html, /users/_.html ...). S3 does not map clean URLs to those files, so this function does:
//   /                     -> /index.html
//   /tickets              -> /tickets.html          (also with a trailing slash)
//   /users/new            -> /users/new.html
//   /tickets/<any id>     -> /tickets/_.html        (the page reads the real id from the address bar)
//   /logo.png, /_next/... -> unchanged
// A URL with no matching file gets a 403/404 from S3; give the distribution a custom error response that serves
// /404.html with status 404 (see deploy/cloudfront/README.md).
//
// KEEP IN STEP WITH THE BUILD: STATIC_CHILDREN lists the fixed pages that live under a detail route
// (for example /assets/new). `npm run check:static` fails if this list no longer matches the build.
/* eslint-disable @typescript-eslint/no-unused-vars -- `handler` is called by CloudFront, not by this repository. */
var DETAIL_ROUTES = ['tickets', 'users', 'assets', 'agent/tickets', 'super-admin/work'];
var STATIC_CHILDREN = {
  'tickets': ['dashboard'],
  'users': ['new', 'departments'],
  'assets': ['new', 'hardware', 'software', 'assignment', 'history', 'status', 'warranty'],
  'agent/tickets': [],
  'super-admin/work': []
};

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.indexOf('/_next/') === 0) return request;
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') !== -1) return request;

  if (uri.length > 1 && uri.charAt(uri.length - 1) === '/') uri = uri.substring(0, uri.length - 1);
  if (uri === '' || uri === '/') {
    request.uri = '/index.html';
    return request;
  }

  for (var i = 0; i < DETAIL_ROUTES.length; i++) {
    var prefix = '/' + DETAIL_ROUTES[i] + '/';
    if (uri.indexOf(prefix) === 0) {
      var rest = uri.substring(prefix.length);
      if (rest.length > 0 && rest.indexOf('/') === -1 && STATIC_CHILDREN[DETAIL_ROUTES[i]].indexOf(rest) === -1 && rest !== '_') {
        request.uri = prefix + '_.html';
        return request;
      }
    }
  }
  request.uri = uri + '.html';
  return request;
}
