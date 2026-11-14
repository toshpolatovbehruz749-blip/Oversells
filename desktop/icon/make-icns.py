#!/usr/bin/env python3
"""Builds desktop/mac/Oversells.icns from desktop/mac/Oversells-icon.png (needs Pillow)."""
from pathlib import Path
from PIL import Image

mac = Path(__file__).resolve().parent.parent / "mac"
Image.open(mac / "Oversells-icon.png").save(
    mac / "Oversells.icns", sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]
)
print("desktop/mac/Oversells.icns")
