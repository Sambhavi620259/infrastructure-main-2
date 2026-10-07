"""Implementation file: app/services/qr_service.py"""
import io
import base64
from typing import Optional
import qrcode
from qrcode.image.pil import PilImage


def generate_qr_code_base64(data: str) -> str:
    """
    Generate a QR code image encoded as a base64 PNG data URL string.
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(data)
    qr.make(fit=True)

    img: PilImage = qr.make_image(fill_color="black", back_color="white")
    
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    
    base64_encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{base64_encoded}"


def generate_asset_qr_data(asset_id: str, company_id: str, tag_number: Optional[str] = None) -> str:
    """
    Construct standardized payload string for asset identification tags.
    """
    return f"ASSET:{company_id}:{asset_id}:{tag_number or ''}"