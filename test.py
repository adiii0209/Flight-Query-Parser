import gspread
from google.oauth2.service_account import Credentials
from datetime import datetime
import re

# ---------- AUTH ----------
scope = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

creds = Credentials.from_service_account_file(
    "credentials.json",
    scopes=scope
)

client = gspread.authorize(creds)

sheet = client.open_by_key("1jfm16HEq0G2XeXiyqK2Q3xyNbcSkt1DPtsEV6_256sk").sheet1

data = sheet.get_all_values()

month_label = datetime.now().strftime("%b %Y")

month_row = None

# ---------- FIND CURRENT MONTH ----------
for i, row in enumerate(data):
    if month_label in row:
        month_row = i
        break

if month_row is None:
    raise Exception("Month section not found")

month_pattern = re.compile(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}")

insert_row = None

# ---------- FIND NEXT MONTH ----------
for i in range(month_row + 1, len(data)):

    row_text = " ".join(data[i])

    if month_pattern.search(row_text) and month_label not in row_text:
        insert_row = i
        break

# If no next month, insert at bottom
if insert_row is None:
    insert_row = len(data)

# ---------- PREVIOUS BALANCE ----------
prev_balance = float(data[insert_row - 1][10])

# ---------- INPUT DATA ----------
invoice_no = "DTI00011851"
pnr = "ABC123"
basic = 12000
k3 = 600
other_tax = 1800
mu = 472

# ---------- CALCULATIONS ----------
ticket_total = basic + k3 + other_tax + mu
indigo_total = ticket_total - mu
running_balance = prev_balance - indigo_total

# ---------- ROW ----------
new_row = [
    invoice_no,
    datetime.now().strftime("%d-%b-%Y"),
    pnr,
    basic,
    k3,
    other_tax,
    mu,
    "",
    ticket_total,
    indigo_total,
    running_balance,
    "AB",
    "New",
    "Vesuvius",
    "",
    "",
    "",
    ""
]

# ---------- INSERT ----------
sheet.insert_row(new_row, insert_row)

print("Row inserted at last row of current month.")