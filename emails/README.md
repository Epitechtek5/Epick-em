# Resend email templates

Import the HTML files, assign the aliases below, declare variables as strings,
set the subject and publish each template. A saved draft cannot be used for sends.
Each filename is its alias followed by `.html`, except Spanish confirmation:
`email-address-confirmation-es.html` uses the alias `email-confirmation-es`.

| Alias | Subject | Variables used in HTML |
| --- | --- | --- |
| `notification-fr` | `{{{TITLE}}}` | `TITLE`, `BODY` |
| `notification-en` | `{{{TITLE}}}` | `TITLE`, `BODY` |
| `notification-es` | `{{{TITLE}}}` | `TITLE`, `BODY` |
| `welcome-account-fr` | `Bienvenue sur Epick'em !` | `USERNAME` |
| `welcome-account-en` | `Welcome to Epick'em!` | `USERNAME` |
| `welcome-account-es` | `¡Te damos la bienvenida a Epick'em!` | `USERNAME` |
| `email-address-confirmation-fr` | `Confirmez votre adresse e-mail` | `VERIFICATION_URL` |
| `email-address-confirmation-en` | `Confirm your email address` | `VERIFICATION_URL` |
| `email-confirmation-es` | `Confirma tu dirección de correo` | `VERIFICATION_URL` |
| `password-reset-fr` | `Réinitialisez votre mot de passe` | `RESET_URL` |
| `password-reset-en` | `Reset your password` | `RESET_URL` |
| `password-reset-es` | `Restablece tu contraseña` | `RESET_URL` |

## Configuration for the local web frontend

```dotenv
PUBLIC_URL=http://localhost:3000
RESEND_NOTIFICATION_TEMPLATE_FR=notification-fr
RESEND_NOTIFICATION_TEMPLATE_EN=notification-en
RESEND_NOTIFICATION_TEMPLATE_ES=notification-es
RESEND_WELCOME_TEMPLATE_FR=welcome-account-fr
RESEND_WELCOME_TEMPLATE_EN=welcome-account-en
RESEND_WELCOME_TEMPLATE_ES=welcome-account-es
RESEND_EMAIL_VERIFICATION_TEMPLATE_FR=email-address-confirmation-fr
RESEND_EMAIL_VERIFICATION_TEMPLATE_EN=email-address-confirmation-en
RESEND_EMAIL_VERIFICATION_TEMPLATE_ES=email-confirmation-es
RESEND_PASSWORD_RESET_TEMPLATE_FR=password-reset-fr
RESEND_PASSWORD_RESET_TEMPLATE_EN=password-reset-en
RESEND_PASSWORD_RESET_TEMPLATE_ES=password-reset-es
```

Keep your existing `RESEND_API_KEY` and verified sender in `MAIL_FROM`. Recreate
the API container after editing its environment. The local `.env` has been aligned
with these 12 aliases. The Spanish confirmation file remains named
`email-address-confirmation-es.html`, but its Resend alias is `email-confirmation-es`:
the longer alias is reserved by another template in this Resend account.

Welcome and notification buttons open `http://localhost:3000`. Notification buttons
open the home page because team events have no action URL. Reset and verification
retain their token-bearing variables: the backend uses PUBLIC_URL to build
`http://localhost:3000/reset-password?token=...` and
`http://localhost:3000/verify-email?token=...`. Do not hardcode a token in the HTML.

Open local links on the computer hosting the frontend; localhost on a phone refers
to the phone. For Vite on port 5173, change PUBLIC_URL and the fixed links in the
welcome/notification files, then republish those templates.

## Language selection

All four email families select templates using the account language. Registration
accepts optional `language` (`fr`, `en`, `es`) and persists it before sending welcome
and confirmation emails. Mobile and web registration send their current language.
Without a language or saved settings, French is used. Resends, pending-address
verification and password recovery use saved settings. Security emails still ignore
notification opt-outs. Language-specific environment variables override legacy
unsuffixed variables, which remain a compatibility fallback.

The unsupported boolean `HAS_ACTION` has been removed from the backend payload.
Notification templates declare `TITLE`, `BODY`, `CATEGORY`, `LANGUAGE`, `ACTION_URL`
as strings. The last three are metadata, unused in the HTML. No Handlebars conditions
are needed.

## Preview and testing

Preview with USERNAME=`Alice`, a localized TITLE/BODY, and
RESET_URL=`http://localhost:3000/reset-password?token=preview` or
VERIFICATION_URL=`http://localhost:3000/verify-email?token=preview`.
Preview tokens do not authenticate. Keep placeholders in the published HTML.

Check desktop/mobile widths, long titles, accents and fallback links. For functional
tests, register a real inbox you own, follow the actual verification link and trigger
password recovery. For notifications, use a verified account with the relevant
email preference enabled and add it to a team or change a tournament status.

The HTML follows the root welcome layout: 560px card, purple accents, light
background, responsive spacing, preheader and localized footer. Regenerate it with
`python3 scripts/generate_email_templates.py` from the repository root.

References:
- https://resend.com/docs/dashboard/templates/introduction
- https://resend.com/docs/api-reference/templates/create-template
