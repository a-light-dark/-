# -*- coding: utf-8 -*-
"""生成 tabBar 图标（81x81 PNG，灰色未选中 / 绿色选中）"""
import os
from PIL import Image, ImageDraw

OUT = r"E:\steam\应用\软件\campus-forum\miniprogram\images\tab"
os.makedirs(OUT, exist_ok=True)

S = 4                 # 超采样倍数
N = 81                # 最终尺寸
W = N * S             # 画布尺寸
GRAY = (128, 128, 128, 255)
GREEN = (7, 193, 96, 255)
CLEAR = (0, 0, 0, 0)
STROKE = 12


def canvas():
    return Image.new("RGBA", (W, W), CLEAR)


def line(d, pts, fill, width=STROKE):
    d.line(pts, fill=fill, width=width, joint="curve")
    r = width / 2.0
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=fill)


def save(im, name):
    im = im.resize((N, N), Image.LANCZOS)
    im.save(os.path.join(OUT, name), "PNG")


def arc_circle(d, cx, cy, r, fill, width=STROKE):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=fill, width=width)


# ---------------- 首页：房子 ----------------
def home(color, filled=False):
    im = canvas()
    d = ImageDraw.Draw(im)
    if filled:
        d.polygon([(162, 40), (286, 158), (38, 158)], fill=color)
        d.rounded_rectangle([70, 140, 254, 286], radius=14, fill=color)
        d.rounded_rectangle([134, 206, 190, 286], radius=8, fill=CLEAR)
    else:
        line(d, [(40, 158), (162, 40), (284, 158)], color)
        line(d, [(74, 150), (74, 282)], color)
        line(d, [(250, 150), (250, 282)], color)
        line(d, [(74, 282), (250, 282)], color)
        line(d, [(136, 282), (136, 206), (188, 206), (188, 282)], color)
    return im


# ---------------- 互助：双向箭头 ----------------
def help_icon(color, filled=False):
    im = canvas()
    d = ImageDraw.Draw(im)
    w = STROKE if not filled else 20
    # 上箭头向右
    line(d, [(80, 116), (232, 116)], color, w)
    line(d, [(196, 78), (236, 116), (196, 154)], color, w)
    # 下箭头向左
    line(d, [(244, 208), (92, 208)], color, w)
    line(d, [(128, 170), (88, 208), (128, 246)], color, w)
    return im


# ---------------- 发帖：圆 + 加号 ----------------
def publish(color, filled=False):
    im = canvas()
    d = ImageDraw.Draw(im)
    if filled:
        d.ellipse([28, 28, 296, 296], fill=color)
        plus = CLEAR
    else:
        d.ellipse([28, 28, 296, 296], outline=color, width=STROKE)
        plus = color
    line(d, [(162, 96), (162, 228)], plus, 16)
    line(d, [(96, 162), (228, 162)], plus, 16)
    return im


# ---------------- 消息：气泡 + 三个点 ----------------
def message(color, filled=False):
    im = canvas()
    d = ImageDraw.Draw(im)
    if filled:
        d.rounded_rectangle([40, 62, 284, 236], radius=40, fill=color)
        d.polygon([(86, 232), (150, 232), (96, 288)], fill=color)
        dot = CLEAR
    else:
        d.rounded_rectangle([40, 62, 284, 236], radius=40, outline=color, width=STROKE)
        d.polygon([(90, 228), (146, 228), (98, 282)], fill=color)
        dot = color
    for cx in (116, 162, 208):
        r = 9
        d.ellipse([cx - r, 149 - r, cx + r, 149 + r], fill=dot)
    return im


# ---------------- 我的：头 + 肩 ----------------
def mine(color, filled=False):
    im = canvas()
    d = ImageDraw.Draw(im)
    if filled:
        d.ellipse([106, 44, 218, 156], fill=color)
        d.pieslice([62, 180, 262, 380], 180, 360, fill=color)
    else:
        arc_circle(d, 162, 100, 56, color)
        d.arc([62, 180, 262, 340], 180, 360, fill=color, width=STROKE)
        line(d, [(62, 260), (62, 276)], color)  # 收尾
        line(d, [(262, 260), (262, 276)], color)
    return im


ICONS = {
    "home": home,
    "help": help_icon,
    "publish": publish,
    "message": message,
    "mine": mine,
}

for name, fn in ICONS.items():
    save(fn(GRAY, filled=False), name + ".png")
    save(fn(GREEN, filled=True), name + "-on.png")

print("done", os.listdir(OUT))
