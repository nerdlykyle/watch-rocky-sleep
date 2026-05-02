from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "rocky-layer-composite-check.png"
OUT_DIR = ROOT / "media"
OUT = OUT_DIR / "watch-rocky-sleep-product.jpg"

WIDTH = 1600
HEIGHT = 1200
PIXEL_SCALE = 4


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/consolab.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_pixel_window(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, fill: tuple[int, int, int]) -> None:
    x1, y1, x2, y2 = box
    border = (38, 43, 51)
    highlight = (184, 196, 209)
    title_bar = (63, 82, 112)
    shadow = (14, 17, 22)
    draw.rectangle((x1 + 14, y1 + 14, x2 + 14, y2 + 14), fill=shadow)
    draw.rectangle(box, fill=border)
    draw.rectangle((x1 + 8, y1 + 8, x2 - 8, y2 - 8), fill=fill)
    draw.rectangle((x1 + 8, y1 + 8, x2 - 8, y1 + 56), fill=title_bar)
    draw.line((x1 + 8, y2 - 8, x2 - 8, y2 - 8), fill=highlight, width=2)
    for i, color in enumerate([(238, 104, 91), (245, 198, 87), (112, 204, 126)]):
        cx = x1 + 34 + i * 34
        draw.rectangle((cx, y1 + 25, cx + 14, y1 + 39), fill=color)
    draw.text((x1 + 140, y1 + 24), title, fill=(218, 226, 232), font=font(22))


def draw_background(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)
    for y in range(HEIGHT):
        t = y / HEIGHT
        r = round(28 + 26 * t)
        g = round(38 + 21 * t)
        b = round(54 + 28 * t)
        draw.line((0, y, WIDTH, y), fill=(r, g, b))

    draw_pixel_window(draw, (-90, 190, 760, 800), "active-window.exe", (49, 60, 72))
    draw_pixel_window(draw, (650, 110, 1710, 780), "desktop://sleep", (35, 50, 58))
    draw_pixel_window(draw, (190, 610, 1330, 1135), "taskbar edge", (44, 53, 47))

    for x in range(84, WIDTH, 134):
        draw.rectangle((x, 865, x + 58, 923), fill=(81, 101, 120))
        draw.rectangle((x + 9, 874, x + 49, 914), fill=(112, 138, 157))

    draw.rectangle((0, 1118, WIDTH, HEIGHT), fill=(24, 28, 33))
    draw.rectangle((0, 1118, WIDTH, 1128), fill=(88, 102, 119))
    for i, label in enumerate(["Rocky", "Sleep", "Perch", "Coffee"]):
        x = 48 + i * 190
        draw.rectangle((x, 1140, x + 150, 1182), fill=(54, 65, 76))
        draw.text((x + 22, 1150), label, fill=(220, 226, 217), font=font(18))


def draw_title(img: Image.Image) -> None:
    title = "Watch Rocky Sleep"
    small = Image.new("RGBA", (WIDTH // PIXEL_SCALE, 260), (0, 0, 0, 0))
    draw = ImageDraw.Draw(small)
    title_font = font(30)
    bbox = draw.textbbox((0, 0), title, font=title_font)
    x = (small.width - (bbox[2] - bbox[0])) // 2
    y = 30
    for dx, dy in [(-3, 0), (3, 0), (0, -3), (0, 3), (-3, -3), (3, 3)]:
        draw.text((x + dx, y + dy), title, fill=(22, 20, 18), font=title_font)
    draw.text((x, y), title, fill=(246, 208, 124), font=title_font)
    draw.text((x, y + 5), title, fill=(166, 95, 66), font=title_font)
    draw.text((x, y), title, fill=(246, 208, 124), font=title_font)
    title_img = small.resize((WIDTH, 260 * PIXEL_SCALE), Image.Resampling.NEAREST)
    img.alpha_composite(title_img, (0, 18))


def paste_rocky(img: Image.Image) -> None:
    rocky = Image.open(SOURCE).convert("RGBA")
    bbox = rocky.getbbox()
    if bbox:
        rocky = rocky.crop(bbox)
    target_width = 1120
    scale = target_width / rocky.width
    resized = rocky.resize((target_width, round(rocky.height * scale)), Image.Resampling.NEAREST)
    shadow = Image.new("RGBA", resized.size, (0, 0, 0, 0))
    shadow.putalpha(resized.getchannel("A").filter(ImageFilter.GaussianBlur(10)))
    shadow = Image.new("RGBA", (shadow.width + 80, shadow.height + 60), (0, 0, 0, 0))
    shadow.alpha_composite(resized.filter(ImageFilter.GaussianBlur(4)), (40, 30))
    shadow.putalpha(shadow.getchannel("A").point(lambda a: round(a * 0.34)))

    x = (WIDTH - resized.width) // 2
    y = 455
    img.alpha_composite(shadow, (x - 40, y + 54))
    img.alpha_composite(resized, (x, y))


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 255))
    draw_background(img)
    draw_title(img)
    paste_rocky(img)
    rgb = img.convert("RGB")
    rgb.save(OUT, quality=92, optimize=True, subsampling=0)
    print(OUT)


if __name__ == "__main__":
    main()
