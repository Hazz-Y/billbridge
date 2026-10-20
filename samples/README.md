# Sample invoices (synthetic)
- `invoice-aurora-001.pdf` — clean layout: Sharma Precision Components → Aurora Motors, INV-2025-001, ₹4,00,000 (the live demo invoice). Fallback extractor scores ≥ 85 on every field.
- `invoice-aurora-001-scan-like.pdf` — same data, messy layout, no explicit due date (only "Payment terms: Net 67 days") → amber inferred due date (confidence 70) + warning.
- `invoice-kaveri-002.pdf` — Kaveri Textiles → Meridian Retail, INV-2025-002, ₹2,50,000 (second upload).
- Regenerate with `npm run samples --workspace backend` (dates are computed from today; the generator prints them). All GSTINs are synthetic (`DEMO_GSTINS`).
