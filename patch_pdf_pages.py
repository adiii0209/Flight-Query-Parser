import sys

with open('hotel_pdf.py', 'r', encoding='utf-8') as f:
    content = f.read()

start_idx = content.find('def draw_hotel_voucher(c, data):')
end_idx = content.find('# ── Sample data ──')

old_func = content[start_idx:end_idx]

new_func = old_func.replace(
    'GAP_SM = 10    # small gap',
    'GAP_SM = 10    # small gap\n\n    def draw_footer_and_page(current_y):\n        hline(c, M, BOT + 36, IW)\n        FOOT_Y = BOT + 16\n        txt(c, M, FOOT_Y, "timetours.in  ·  +91 33 400 11 333", size=8, color=C_TEXT_SEC)\n        txt(c, R,  FOOT_Y, "13, Camac Street, Kolkata 700017",   size=8, color=C_TEXT_SEC, align="right")\n        c.showPage()\n        return H - 44'
)

new_func = new_func.replace(
    'if has_room_data:\n        txt(c, M, T, "ROOMS & GUESTS", size=7, color=C_TEXT_TER, bold=True)\n        ry = T - 16\n\n        for idx, room in enumerate(rooms[:6]):\n            if ry - 28 < BOT + 60: break',
    'if has_room_data:\n        if T < BOT + 80: T = draw_footer_and_page(T)\n        txt(c, M, T, "ROOMS & GUESTS", size=7, color=C_TEXT_TER, bold=True)\n        ry = T - 16\n\n        for idx, room in enumerate(rooms):\n            if ry < BOT + 80: ry = draw_footer_and_page(ry)'
)

new_func = new_func.replace(
    '# ── 6.5 SPECIAL INSTRUCTIONS ──────────────────────────────────────────────\n    special = data.get("special_instructions")\n    if has_value(special):',
    '# ── 6.5 SPECIAL INSTRUCTIONS ──────────────────────────────────────────────\n    special = data.get("special_instructions")\n    if has_value(special):\n        if T < BOT + 60: T = draw_footer_and_page(T)'
)

new_func = new_func.replace(
    'if data.get("show_paid_logo"):\n        txt(c, M, T, "PAYMENT", size=7, color=C_TEXT_TER, bold=True)',
    'if data.get("show_paid_logo"):\n        if T < BOT + 60: T = draw_footer_and_page(T)\n        txt(c, M, T, "PAYMENT", size=7, color=C_TEXT_TER, bold=True)'
)

new_func = new_func.replace(
    '# ── 7. AMENITIES ──────────────────────────────────────────────────────────\n    amenities = data.get("amenities") or []\n    if not isinstance(amenities, list): amenities = []\n\n    if amenities:',
    '# ── 7. AMENITIES ──────────────────────────────────────────────────────────\n    amenities = data.get("amenities") or []\n    if not isinstance(amenities, list): amenities = []\n\n    if amenities:\n        if T < BOT + 80: T = draw_footer_and_page(T)'
)

new_func = new_func.replace(
    '# ── 8. TOTAL AMOUNT ───────────────────────────────────────────────────────\n    total_label = format_amount(data.get("total_amount"), data.get("currency"))\n    if total_label:',
    '# ── 8. TOTAL AMOUNT ───────────────────────────────────────────────────────\n    total_label = format_amount(data.get("total_amount"), data.get("currency"))\n    if total_label:\n        if T < BOT + 60: T = draw_footer_and_page(T)'
)

new_func = new_func.replace(
    '# ── 9. FOOTER ─────────────────────────────────────────────────────────────\n    hline(c, M, BOT + 36, IW)\n    FOOT_Y = BOT + 16\n    txt(c, M, FOOT_Y, "timetours.in  ·  +91 33 400 11 333", size=8, color=C_TEXT_SEC)\n    txt(c, R,  FOOT_Y, "13, Camac Street, Kolkata 700017",   size=8, color=C_TEXT_SEC, align="right")\n',
    '# ── 9. FOOTER ─────────────────────────────────────────────────────────────\n    draw_footer_and_page(T)\n'
)

with open('hotel_pdf.py', 'w', encoding='utf-8') as f:
    f.write(content[:start_idx] + new_func + content[end_idx:])
print('DONE')
