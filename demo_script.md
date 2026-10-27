# DCM MoM Insights PoC: demo script

About 12 minutes. Run on the PoC stack: Azure AI Search (Central India), gpt-4.1-mini and text-embedding-3-large
(Standard, South India), FastAPI on :8000, web app on :3000. Data: 5 Board meetings (132 scanned pages, 2015-2025)
plus the Synopsis of Minutes register. Every expected answer below was checked against the minutes.

## Before the demo

1. Start the backend: from `04_PoC/api`, `..\.venv-api\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000`.
2. Start the web app: from `04_PoC/web`, `npm run dev`, then open http://localhost:3000.
3. Ask one warm-up question so the first answer isn't slow.

## 1. A plain lookup, with the page to prove it (2 min)

- **Ask:** "What final dividend did the Board recommend in May 2024?"
- **Expect:** 130%, i.e. Rs. 2.60 per equity share, FY 2023-24, meeting of 6 May 2024, item 3.4.4.
- **Show:** open the source and the scanned minute-book page 2310 opens. This is the audit trail: every answer leads
  back to the signed page.

## 2. Follow-up questions (3 min)

- "And in 2021?" → Re. 3.80 (190%), FY 2020-21.
- "What record date was fixed for it?" → 9.7.21.
- "Was there an interim one that year too?" → Rs. 5.50 (275%), declared 19 Jan 2021 (from the Synopsis register).
- **Point:** the bot keeps the context ("it", "that year") and still answers only from the cited minutes.

## 3. An item with more than one decision (2 min)

- **Ask:** "What did the Board approve for renewable power at Kota in October 2024?"
- **Expect:** both approvals in item 3.4.1: capex up to Rs. 23 Crores and an investment of up to Rs. 60 Crores for up to
  28% of an SPV for a 68 MW wind-solar hybrid project.
- **Follow up:** "What stake are we taking in it?" → up to 28%.

## 4. People and exact spellings (2 min)

- "Who chairs the Board Audit Committee after the May 2024 reconstitution?" → Ms. Ramni Nirula, with Mr. Vipin Sondhi,
  Mr. Pravesh Sharma and Mr. Pranam Wahi; Mr. Pradeep Dinodia becomes a Permanent Invitee. Open page 2320 to show the
  table in the scan.
- "Who is our company secretary now?" → Mr. Deepak Gupta from 18 January 2025; then "Who handled the role before him?"
  → Ms. Swati Patil Lahiri, Acting Company Secretary from 22 May 2024.

## 5. Something that is not in the minutes (1 min)

- **Ask:** "Did the Board approve a merger with Tata Chemicals?"
- **Expect:** "Not found in the minutes." The bot doesn't guess.

## 6. Questions for DCM (2 min)

- Ask the Company Secretary's team for 20-30 real questions; they become the acceptance test.
- Confirm the scope of the full archive (Board and committees, subsidiaries, years) and where it sits in SharePoint.
- Confirm what "Indian data residency" means for DCM: storage only, or processing too.

## Known limits to mention if asked

- PoC data is 5 meetings. Lists across many years ("every capex proposal") depend on search finding every item; this
  is the area we keep testing.
- No login yet in the PoC; production uses Microsoft sign-in with access by company and committee.
