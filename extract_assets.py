import os
import json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = '/home/sijan/.gemini/antigravity/brain/761f67c1-8182-4ebc-bd1c-12f0df9e3aeb/.user_uploaded/media_1793799335918_45a115ea.jpg'
OUT_DIR = '/home/sijan/.gemini/antigravity/scratch/sticky-studio/public/assets'
os.makedirs(OUT_DIR, exist_ok=True)

img = Image.open(SRC).convert('RGB')
arr = np.array(img, dtype=np.float32)

bg_color = np.median(np.concatenate([
    arr[0:10, :, :].reshape(-1, 3),
    arr[:, 0:10, :].reshape(-1, 3),
    arr[:, -10:, :].reshape(-1, 3)
], axis=0), axis=0)

def extract_crop_rgba(crop_rgb, is_bust=False, pose_name=None):
    ch, cw, _ = crop_rgb.shape
    luma = 0.299 * crop_rgb[:,:,0] + 0.587 * crop_rgb[:,:,1] + 0.114 * crop_rgb[:,:,2]
    diff_bg = np.linalg.norm(crop_rgb - bg_color[None, None, :], axis=2)

    barrier = (luma < 112) | (diff_bg > 36)

    if not is_bust:
        bottom_band = np.zeros((ch, cw), dtype=bool)
        bottom_band[ch - 32:, :] = True
        barrier = np.where(bottom_band, luma < 85, barrier)

        # In wrist/hip zone (y=180..235), paper background in small gaps between thumb and pants has luma > 130 and diff_bg < 34
        wrist_band = np.zeros((ch, cw), dtype=bool)
        wrist_band[180:235, :] = True
        barrier = np.where(wrist_band & (luma > 132) & (diff_bg < 34), False, barrier)

    ext_seed = np.zeros((ch, cw), dtype=bool)
    ext_seed[0, :] = ~barrier[0, :]
    ext_seed[:, 0] = ~barrier[:, 0]
    ext_seed[:, -1] = ~barrier[:, -1]
    if not is_bust:
        ext_seed[-1, :] = ~barrier[-1, :]
        if pose_name in ('front', 'back'):
            ext_seed[ch - 75:ch - 25, cw//2 - 3:cw//2 + 3] = ~barrier[ch - 75:ch - 25, cw//2 - 3:cw//2 + 3]
        for y_check in range(180, 235):
            for x_check in range(15, cw - 15):
                if diff_bg[y_check, x_check] < 30 and luma[y_check, x_check] > 135:
                    ext_seed[y_check, x_check] = True

    not_barrier = ~barrier
    labeled, _ = ndimage.label(not_barrier)
    seed_labels = np.unique(labeled[ext_seed])
    seed_labels = seed_labels[seed_labels > 0]
    exterior = np.isin(labeled, seed_labels)

    interior = ~exterior
    int_labeled, num_int = ndimage.label(interior)
    if num_int > 1:
        sizes = ndimage.sum(interior, int_labeled, range(1, num_int + 1))
        keep_labels = np.where(sizes > 250)[0] + 1
        interior = np.isin(int_labeled, keep_labels)

    eroded = ndimage.binary_erosion(interior, iterations=1)
    dilated = ndimage.binary_dilation(interior, iterations=1)
    edge_band = dilated & ~eroded

    alpha = interior.astype(np.float32)
    edge_alpha = np.clip((155.0 - luma) / 75.0, 0.0, 1.0)
    alpha = np.where(edge_band, edge_alpha, alpha)
    alpha_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=0.55))
    alpha_final = np.array(alpha_img, dtype=np.float32) / 255.0
    alpha_final = np.where(eroded, 1.0, alpha_final)
    alpha_final = np.where(~dilated, 0.0, alpha_final)

    rgb_clean = crop_rgb.copy()
    semi = (alpha_final > 0.02) & (alpha_final < 0.98)
    for c in range(3):
        rgb_clean[:, :, c] = np.where(
            semi,
            np.clip((crop_rgb[:, :, c] - (1.0 - alpha_final) * bg_color[c]) / np.maximum(alpha_final, 0.2), 0, 255),
            crop_rgb[:, :, c]
        )

    rgba = np.zeros((ch, cw, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.clip(rgb_clean, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.clip(alpha_final * 255, 0, 255).astype(np.uint8)
    return rgba

poses = {
    'front': (210, 10, 370, 368),
    'side':  (475, 10, 585, 368),
    'back':  (665, 10, 825, 368),
}

metadata = {'poses': {}, 'busts': {}}

for name, (x0, y0, x1, y1) in poses.items():
    crop = arr[y0:y1, x0:x1]
    rgba = extract_crop_rgba(crop, is_bust=False, pose_name=name)
    Image.fromarray(rgba).save(f"{OUT_DIR}/pose_{name}_orig.png")

    rgba_blank = rgba.copy()
    luma = 0.299 * rgba[:,:,0] + 0.587 * rgba[:,:,1] + 0.114 * rgba[:,:,2]
    if name in ('front', 'side'):
        head_region = (luma[:90, :] < 45) & (rgba[:90, :, 3] > 200)
        head_filled = ndimage.binary_fill_holes(head_region)
        head_eroded = ndimage.binary_erosion(head_filled, iterations=3)
        ys, xs = np.where(head_filled)
        cx = float((xs.min() + xs.max()) / 2.0)
        cy = float((ys.min() + ys.max()) / 2.0)
        rx = float((xs.max() - xs.min()) / 2.0)
        ry = float((ys.max() - ys.min()) / 2.0)
        for c in range(3):
            sub = rgba_blank[:90, :, c]
            sub[head_eroded] = 8
            rgba_blank[:90, :, c] = sub
        Image.fromarray(rgba_blank).save(f"{OUT_DIR}/pose_{name}_blank.png")
        metadata['poses'][name] = {
            'width': x1 - x0,
            'height': y1 - y0,
            'head': {'cx': cx, 'cy': cy, 'rx': rx, 'ry': ry}
        }
    else:
        Image.fromarray(rgba_blank).save(f"{OUT_DIR}/pose_{name}_blank.png")
        metadata['poses'][name] = {
            'width': x1 - x0,
            'height': y1 - y0,
            'head': None
        }

bust_defs = [
    ('neutral', 65, 385, 240, 571),
    ('happy',   307, 385, 482, 571),
    ('tired',   549, 385, 724, 571),
    ('crying',  791, 385, 966, 571),
]

for bname, x0, y0, x1, y1 in bust_defs:
    crop = arr[y0:y1, x0:x1]
    rgba = extract_crop_rgba(crop, is_bust=True)
    Image.fromarray(rgba).save(f"{OUT_DIR}/bust_{bname}.png")

    luma = 0.299 * rgba[:,:,0] + 0.587 * rgba[:,:,1] + 0.114 * rgba[:,:,2]
    head_region = (luma[:145, :] < 45) & (rgba[:145, :, 3] > 200)
    head_filled = ndimage.binary_fill_holes(head_region)
    head_eroded = ndimage.binary_erosion(head_filled, iterations=4)
    ys, xs = np.where(head_filled)
    cx = float((xs.min() + xs.max()) / 2.0)
    cy = float((ys.min() + ys.max()) / 2.0)
    rx = float((xs.max() - xs.min()) / 2.0)
    ry = float((ys.max() - ys.min()) / 2.0)

    if bname == 'neutral':
        rgba_blank = rgba.copy()
        for c in range(3):
            sub = rgba_blank[:145, :, c]
            sub[head_eroded] = 8
            rgba_blank[:145, :, c] = sub
        Image.fromarray(rgba_blank).save(f"{OUT_DIR}/bust_blank.png")

    face_rgba = np.zeros_like(rgba)
    glow_alpha = np.zeros((y1 - y0, x1 - x0), dtype=np.float32)
    head_luma = luma[:145, :]
    glow_sub = np.where(head_eroded, np.clip((head_luma - 14.0) / 220.0, 0.0, 1.0), 0.0)
    glow_alpha[:145, :] = glow_sub
    face_rgba[:, :, :3] = rgba[:, :, :3]
    face_rgba[:, :, 3] = (glow_alpha * 255).astype(np.uint8)
    Image.fromarray(face_rgba).save(f"{OUT_DIR}/face_{bname}.png")

    # Save mouthless version of face overlay for live lip-syncing
    face_nomouth = face_rgba.copy()
    face_nomouth[95:118, 60:112, 3] = 0
    Image.fromarray(face_nomouth).save(f"{OUT_DIR}/face_nomouth_{bname}.png")

    metadata['busts'][bname] = {
        'width': x1 - x0,
        'height': y1 - y0,
        'head': {'cx': cx, 'cy': cy, 'rx': rx, 'ry': ry}
    }

with open(f"{OUT_DIR}/metadata.json", "w") as f:
    json.dump(metadata, f, indent=2)
