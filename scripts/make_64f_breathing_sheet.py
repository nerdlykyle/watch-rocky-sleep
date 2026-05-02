from __future__ import annotations

from math import cos, pi
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
PARTS_DIR = ROOT / "body parts"

BACKGROUND_SOURCE = PARTS_DIR / "body background.png"
MIDSECTION_SOURCE = PARTS_DIR / "midsection.png"
ARM_L_SOURCE = PARTS_DIR / "arm.l.png"
ARM_R_SOURCE = PARTS_DIR / "arm.r.png"

SHEET_OUT = ROOT / "rocky-sleep-breathing-64f.png"
PREVIEW_OUT = ROOT / "rocky-sleep-breathing-64f-preview.gif"
BODY_LAYER_OUT = ROOT / "rocky-body-layer.png"
APPENDAGES_LAYER_OUT = ROOT / "rocky-appendages-layer.png"
LAYER_CHECK_OUT = ROOT / "rocky-layer-composite-check.png"
KEYFRAMES_OUT = ROOT / "rocky-sleep-breathing-keyframes.png"

FRAME_COUNT = 64
INHALE_END = 33
FRAME_MS = 64
TOP_PADDING = 48

# The exported parts now share the same full canvas. TOP_PADDING shifts the
# whole character down so the midsection can inflate upward without cropping.
LAYER_POS = (0, TOP_PADDING)


def breathing_amount(frame_number: int) -> float:
    if frame_number == 1 or frame_number == FRAME_COUNT:
        return 0.0
    if frame_number <= INHALE_END:
        inhale_t = (frame_number - 1) / (INHALE_END - 1)
        return ease(inhale_t)

    exhale_t = (frame_number - INHALE_END) / (FRAME_COUNT - INHALE_END)
    return 1.0 - ease(exhale_t)


def ease(t: float) -> float:
    return (1.0 - cos(pi * max(0.0, min(1.0, t)))) * 0.5


def load_parts() -> dict[str, Image.Image]:
    return {
        "background": remove_green_fringe(Image.open(BACKGROUND_SOURCE).convert("RGBA")),
        "midsection": remove_green_fringe(Image.open(MIDSECTION_SOURCE).convert("RGBA")),
        "arm_l": remove_green_fringe(Image.open(ARM_L_SOURCE).convert("RGBA")),
        "arm_r": remove_green_fringe(Image.open(ARM_R_SOURCE).convert("RGBA")),
    }


def remove_green_fringe(image: Image.Image) -> Image.Image:
    arr = np.array(image).copy()
    red = arr[:, :, 0].astype(np.int16)
    green = arr[:, :, 1].astype(np.int16)
    blue = arr[:, :, 2].astype(np.int16)
    alpha = arr[:, :, 3]

    chroma = (green > 130) & ((green - red) > 50) & ((green - blue) > 35)
    arr[chroma, 3] = 0

    edge = (alpha > 0) & (alpha < 255) & (green > red) & (green > blue)
    arr[edge, 1] = np.maximum(arr[edge, 0], arr[edge, 2])
    return Image.fromarray(arr, "RGBA")


def make_frame(parts: dict[str, Image.Image], amount: float) -> Image.Image:
    background = parts["base_cut"]
    midsection = parts["midsection"]
    arm_l = parts["arm_l"]
    arm_r = parts["arm_r"]

    frame = background.copy()
    scaled_midsection, midsection_pos, parent_motion = scale_midsection(midsection, amount)
    frame.alpha_composite(scaled_midsection, midsection_pos)
    frame.alpha_composite(offset_layer(arm_l, parent_motion["arm_l_dx"], parent_motion["arm_dy"]), LAYER_POS)
    frame.alpha_composite(offset_layer(arm_r, parent_motion["arm_r_dx"], parent_motion["arm_dy"]), LAYER_POS)
    return frame


def scale_midsection(midsection: Image.Image, amount: float) -> tuple[Image.Image, tuple[int, int], dict[str, int]]:
    amount = max(0.0, amount)
    bbox = midsection.getchannel("A").getbbox()
    if bbox is None:
        return midsection.copy(), LAYER_POS, parented_arm_motion(0, 0)

    if amount <= 0.0001:
        return midsection.copy(), LAYER_POS, parented_arm_motion(0, 0)

    left, top, right, bottom = bbox
    crop = midsection.crop(bbox)
    width, height = crop.size
    # Breathing only inflates from the default exported size. No exhale frame
    # ever goes below 100%.
    scale_x = 1.0 + 0.035 * amount
    scale_y = 1.0 + 0.055 * amount
    new_size = (max(1, round(width * scale_x)), max(1, round(height * scale_y)))
    inflated = crop.resize(new_size, Image.Resampling.BICUBIC)

    anchor_x = LAYER_POS[0] + left + width / 2
    anchor_bottom = LAYER_POS[1] + bottom
    position = (
        round(anchor_x - inflated.width / 2),
        round(anchor_bottom - inflated.height - 5 * amount),
    )
    side_expansion = (new_size[0] - width) / 2
    upward_expansion = (height - new_size[1]) + 5 * amount
    return inflated, position, parented_arm_motion(side_expansion, upward_expansion)


def parented_arm_motion(side_expansion: float, upward_expansion: float) -> dict[str, int]:
    return {
        "arm_l_dx": -round(side_expansion * 0.65),
        "arm_r_dx": round(side_expansion * 0.65),
        "arm_dy": round(upward_expansion * 0.22),
    }


def offset_layer(layer: Image.Image, dx: int, dy: int) -> Image.Image:
    shifted = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    shifted.alpha_composite(layer, (dx, dy))
    return shifted


def cut_moving_parts_from_background(parts: dict[str, Image.Image]) -> Image.Image:
    background = padded_canvas(parts["background"])
    moving_alpha = Image.new("L", background.size, 0)
    paste_alpha(moving_alpha, parts["midsection"], LAYER_POS)
    paste_alpha(moving_alpha, parts["arm_l"], LAYER_POS)
    paste_alpha(moving_alpha, parts["arm_r"], LAYER_POS)

    alpha = ImageChops.subtract(background.getchannel("A"), moving_alpha)
    background.putalpha(alpha)
    return background


def paste_alpha(canvas: Image.Image, layer: Image.Image, position: tuple[int, int]) -> None:
    alpha_layer = Image.new("L", layer.size, 0)
    alpha_layer.paste(layer.getchannel("A"))
    canvas.paste(ImageChops.lighter(canvas.crop((*position, position[0] + layer.width, position[1] + layer.height)), alpha_layer), position)


def write_layers(parts: dict[str, Image.Image]) -> None:
    frame_size = padded_size(parts["background"])
    body_layer = Image.new("RGBA", frame_size, (0, 0, 0, 0))
    body_layer.alpha_composite(parts["midsection"], LAYER_POS)
    body_layer.save(BODY_LAYER_OUT)

    appendages_layer = Image.new("RGBA", frame_size, (0, 0, 0, 0))
    appendages_layer.alpha_composite(parts["arm_l"], LAYER_POS)
    appendages_layer.alpha_composite(parts["arm_r"], LAYER_POS)
    appendages_layer.save(APPENDAGES_LAYER_OUT)

    check = parts["base_cut"].copy()
    check.alpha_composite(parts["midsection"], LAYER_POS)
    check.alpha_composite(parts["arm_l"], LAYER_POS)
    check.alpha_composite(parts["arm_r"], LAYER_POS)
    check.save(LAYER_CHECK_OUT)


def padded_size(image: Image.Image) -> tuple[int, int]:
    return (image.width, image.height + TOP_PADDING)


def padded_canvas(image: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", padded_size(image), (0, 0, 0, 0))
    canvas.alpha_composite(image, (0, TOP_PADDING))
    return canvas


def write_keyframes(sheet: Image.Image, frame_size: tuple[int, int]) -> None:
    width, height = frame_size
    indexes = [0, 16, 32, 48, 63]
    strip = Image.new("RGBA", (width * len(indexes), height), (0, 0, 0, 0))
    for strip_index, frame_index in enumerate(indexes):
        frame = sheet.crop((frame_index * width, 0, (frame_index + 1) * width, height))
        strip.alpha_composite(frame, (strip_index * width, 0))
    strip.save(KEYFRAMES_OUT)


def main() -> None:
    parts = load_parts()
    parts["base_cut"] = cut_moving_parts_from_background(parts)
    write_layers(parts)

    frames = [make_frame(parts, breathing_amount(index + 1)) for index in range(FRAME_COUNT)]
    width, height = parts["base_cut"].size
    sheet = Image.new("RGBA", (width * FRAME_COUNT, height), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * width, 0))
    sheet.save(SHEET_OUT)
    write_keyframes(sheet, parts["base_cut"].size)

    frames[0].save(
        PREVIEW_OUT,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        disposal=2,
        transparency=0,
    )


if __name__ == "__main__":
    main()
