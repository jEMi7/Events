# Event Details UI refinement

## Scope
- Keep the sidebar, event information, KPI cards, filters, search, data, and all existing actions unchanged.
- Update only the Event Details attendee presentation, meeting controls, and semantic intent colours.

## Changes
1. Recompose the desktop attendee table into compact rows with initials avatar, name/job title, stacked contact details, source chip, intent chip, contact/callback dates, attendance, and all seven existing actions aligned horizontally at the far right.
2. Preserve the existing mobile attendee view and all selection, drawer, mutation, callback, note, attendance, and bulk-action behaviour.
3. Replace the existing single meeting control with matching “Open Zoom” and “Copy Zoom link” buttons, using the event’s stored meeting URL and brief copied feedback; hide both when no URL exists.
4. Refine intent chips so confirmed is green, declined is red, maybe is amber, no answer is neutral, call back is blue/purple, and not contacted remains neutral/lavender.

## Technical details
- Reuse the existing button, badge, tooltip, query, and mutation components.
- Use semantic design tokens and existing responsive breakpoints; no backend, route, or business-logic changes.
- Validate the build after editing. Live signed-in visual verification remains skipped unless requested.
