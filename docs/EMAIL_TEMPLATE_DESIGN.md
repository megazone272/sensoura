# SENSOURA email template design

The transactional email renderer uses table-based HTML, inline styles, email-safe Arial/Helvetica fallbacks, explicit `dir="ltr"` or `dir="rtl"`, accessible image alt text, readable content when images are blocked, and an Outlook-compatible link button. It does not use JavaScript, external stylesheets, CSS Grid, Flexbox, or a single full-email image.

The visual language follows SENSOURA's dark forest-green mission branding, pale green feature cards, white content surface, green call-to-action, NASA analog mission label, and dark-green footer. The optional `EMAIL_LOGO_URL` is escaped and only used as an image URL; when it is absent the email remains readable with a text monogram.

Supported templates are `welcome`, `sensor-alert`, `ai-prediction`, `account-update`, and `contact-confirmation`. Every template has Arabic and English rendering. Dynamic values are escaped before insertion. Dashboard links are accepted only when their origin is listed in `FRONTEND_URL`, preventing an open redirect through email content.

The renderer returns both `html` and a plain-text fallback. Delivery history records recipient, subject, template, language, timestamp, and accepted/failed state, but never stores SMTP passwords, authentication headers, or full email bodies.

Actual Gmail/Outlook rendering should be checked with a controlled test mailbox after SMTP credentials are configured. Automated tests validate the generated markup and direction but cannot prove every external mail client pixel layout.
