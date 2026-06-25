from PIL import Image, ImageDraw, ImageFont
import os

base='/home/zorinos/.openclaw/workspace/store-admin/pdf_edit'
reg='/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'
bold='/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'

coords = {
    1: [
        ('Nihada Karahodzic', 400, 519, 350, 34, 24, True),
        ('38762845973', 399, 426, 160, 24, 18, False),
        ('Payment from HK Bangder Technology Lo.,Ltd.', 385, 1006, 620, 22, 14, False),
        ('828.3', 1702, 1006, 90, 22, 14, False),
        ('1638.97', 2272, 1006, 120, 22, 14, False),
    ],
    2: [
        ('Payment from HK Bangder Technology Lo.,Ltd.', 385, 1061, 620, 22, 14, False),
        ('991.25', 1702, 1061, 100, 22, 14, False),
        ('1415.26', 2258, 1061, 120, 22, 14, False),
    ],
    3: [
        ('Payment from HK Bangder Technology Lo.,Ltd.', 385, 1887, 620, 22, 14, False),
        ('984.11', 1702, 1887, 100, 22, 14, False),
        ('1596.57', 2258, 1887, 120, 22, 14, False),
    ]
}

for page_num, edits in coords.items():
    path=os.path.join(base, f'page-{page_num}.png')
    if not os.path.exists(path):
        path=os.path.join(base, f'page-{page_num:01d}.png')
    img=Image.open(path).convert('RGB')
    draw=ImageDraw.Draw(img)
    for text,x,y,w,h,size,is_bold in edits:
        draw.rectangle([x-6,y-4,x+w+8,y+h+6], fill='white')
        font=ImageFont.truetype(bold if is_bold else reg, size)
        draw.text((x,y-1), text, fill='black', font=font)
    img.save(path)

images=[]
for i in [1,2,3]:
    path=os.path.join(base, f'page-{i}.png')
    if not os.path.exists(path):
        path=os.path.join(base, f'page-{i:01d}.png')
    images.append(Image.open(path).convert('RGB'))

out='/home/zorinos/.openclaw/workspace/store-admin/edited-account-statement-raster.pdf'
images[0].save(out, save_all=True, append_images=images[1:], resolution=300)
print(out)
