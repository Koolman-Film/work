# UI Screens & Patterns

Implementation reference for every screen, form, modal, alert, and state in V1.

---

## File index

| File | Scope |
|---|---|
| **[flows.md](./flows.md)** | 20 user journeys cross-screen (FL-1 → FL-20) — auth, employee, admin, owner, cross-cutting |
| **[navigation.md](./navigation.md)** | Site map, nav patterns per role, URL structure, breadcrumbs, mobile drawer, deep linking |
| **[auth.md](./auth.md)** | 4 screens, 5 forms, 2 modals, 6 toasts, 4 email templates, 8 edge cases |
| **[employee.md](./employee.md)** | 11 screens, 5 forms, 5 modals, 9 toasts, 5 edge cases |
| **[admin.md](./admin.md)** | 23 screens, 12 forms, 9 modals/drawers, 11 toasts, 8 edge cases |
| **[owner.md](./owner.md)** | 4 screens (read-only), 0 forms, 3 edge cases |
| **[shared-patterns.md](./shared-patterns.md)** | 4 common modals, 8 common toasts, empty/error/loading state catalog, drawer patterns, status badge color map |
| **[mockups/](./mockups/)** | 28 visual HTML mockups + index — auth (5) + employee (7) + admin (13) + owner (3) |

---

## ID system (for cross-reference)

| Prefix | Meaning |
|---|---|
| **S-** | Screen (e.g., `S-A1` = first auth screen = Login) |
| **F-** | Form (e.g., `F-A1` = Login form) |
| **M-** | Modal (e.g., `M-A1` = session-expired modal) |
| **T-** | Toast (e.g., `T-A1` = login success toast) |
| **E-** | Email template (e.g., `E-A1` = invite email) |
| **X-** | Edge case (e.g., `X-A1` = rate-limited) |
| **D-** | Drawer/Sheet (e.g., `D-A1` = ...) |

Letter after prefix indicates the section:
- **A** = Auth
- **E** = Employee
- **N** = Admin (using N to distinguish from Employee's E)
- **O** = Owner
- **C** = Common/shared

So `S-N12` = Admin screen #12, `F-E3` = Employee form #3, `T-C4` = common toast #4.

---

## Reading order

1. **flows.md** first — understand user journeys
2. **navigation.md** — see nav patterns per role
3. Per-role file (auth → employee → admin → owner)
4. **shared-patterns.md** — for cross-cutting components

Or jump to specific screen via anchor: `screens/admin.md#s-n12-payroll-detail`

---

## Conventions used in screen specs

### Wireframes

ASCII art with these characters:
- `┌─┐ │ └─┘` — boxes / cards
- `[ ... ]` — buttons
- `─────` — dividers
- `▼` — dropdowns
- `🔔 👤` — common icons (Lucide)

### Status indicators

- ⭐ = Critical screen (build first)
- 🟡 = Important (build mid-project)
- 🟢 = Nice to have (build last)

### Typography in wireframes

```
H1 = "Page Title"
H2 = "Section Heading"
H3 = "subsection"
[BUTTON] = button label
{field name} = form field
"placeholder" = sample text
฿1,234.56 = sample number
```

---

## Cross-references

Screen specs reference:
- **[design-system.md](../design-system.md)** for tokens (colors, typography, spacing, components)
- **[architecture.md](../architecture.md)** for Server Actions + folder structure + roles/permissions
- **[feature-spec.md](../feature-spec.md)** for business logic + acceptance criteria
- **[build-plan.md](../build-plan.md)** for which phase each screen belongs to

---

## Status

- ✅ **All 7 spec files complete** — flows, navigation, auth, employee, admin, owner, shared-patterns
- ✅ **28 mockup files** — index + 5 auth + 7 employee + 13 admin + 3 owner

**Coverage:**
- Auth: 4/4 screens specced + 5 mockups (incl. edge states)
- Employee: 11/11 specced + 7 mockups (dashboard, leave list, leave new, leave detail, advance new, payslip, profile)
- Admin: 23/23 specced + 13 mockups (dashboard, employee-list, employee-form, leave-inbox, attendance, excel-upload, payroll-list, payroll-run⭐⭐, payroll-detail, accounting, audit-log, settings-branches, payroll-config)
- Owner: 4/4 specced + 3 mockups (dashboard, calendar, payroll read-only)

Remaining mockup gap-fill: ~4 employee + ~10 admin + 1 owner (audit read-only) follow established patterns — build on-demand during W1–W10 impl.
