# Judges' test file: what's in it and what our parser must handle

Source: the Case 1 template Google Sheet (`Case1_Franchise_Test_Data_Format.xlsx`).
I downloaded it on 25 Oct 2026. It is identical to our copy in `data/template/`.

## The 6 tabs

| Tab | What's in it | Do we read it? |
|---|---|---|
| Applications | Title row, header row, example row (APP-001 Ravi Kumar). Real data starts at row 4. | Yes |
| Territories | Title row, header row, example row (TER-01 Mysuru). Real data starts at row 4. | Yes |
| Existing stores | ST-01 to ST-10 (fixed, "do not edit") | Yes. Fall back to our hard-coded list if this tab is missing. |
| Allowed values | 7 cities, their pin starts and tiers, plus a "Preferred language" row at the bottom | No |
| Field guide | Which columns are required and which are optional | No (reference only) |
| Glossary | What each column means | No (reference only) |

## Rules from the Field guide and Glossary

- **Required:** Application ID, name, city, state, pin code, investment, retail experience, space available.
- **Optional:** current/past business, space size, floor, target launch, preferred language, notes.
- **Floor is optional.** A blank floor means "Not known". It must not put the applicant on Hold.
- **Preferred language is free text**, not a dropdown ("e.g. Hindi, Kannada, English"). Expect "kannada", "KN" or "Kannada/English". Normalise these. Anything else becomes English, with a flag.
- **Target launch** = months from today.
- **Retail experience** = years spent running or managing any shop.
- **Territory ID is not on applications.** Link applicants to territories by pin code.
- **The brand never opens two stores in the same pin code.** This includes existing stores.

## Parser checklist

1. Find each tab by name, then find its header row by matching column names. Don't assume the headers are on row 2.
2. Ignore Allowed values, Field guide and Glossary. Never read the language row in Allowed values as a city.
3. Match headers loosely: "Pin code" / "Pin" / "Pincode"; "Opened (year)" / "Opened"; investment with or without "(₹ lakh)".
4. Drop the example row only if it's left untouched.
5. Pin codes can arrive as numbers. Turn them into 6-digit text. Split "Pin codes covered" on commas and trim each pin.
6. Never crash on blank optional fields. Use a default plus a flag: floor becomes Not known, language English, launch 6 months.
7. Judges may upload only Applications and Territories. In that case, use the fixed list of existing stores.
8. When chat updates an applicant (e.g. "APP-012 found a ground-floor space"), recheck that applicant's flags. Otherwise old flags like the space contradiction stay on.
