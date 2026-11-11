# TODO

- [ ] Firm setting to pause reminders for one request
- [ ] Short accountant note on each checklist item
- [x] More tests for signed links (version rotation across secrets) and send-window edge cases
- [x] Tests for reminder cadence boundaries and daily email cap
- [x] CSV export of request status on the dashboard
- [ ] Dashboard filter: open / complete / overdue requests
- [ ] Show reminders_sent and next reminder time on the request detail page
- [x] Tests for suggestDueDate same-day and year-end edge cases
- [x] Tests for requestsToCsv escaping of quotes and newlines
- [x] Test that every pack template has a non-empty Arabic title (covered by 'region packs')
- [ ] Tests for waLink/waMessage with Arabic text and special characters
- [ ] Test planForEvent covers every webhook event type
- [ ] Test capRemaining with zero and over-cap sent counts
