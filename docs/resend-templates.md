# Notification templates for local development

Import the three root-level HTML files into Resend and publish each template:

| File | Suggested display name | Required alias |
| --- | --- | --- |
| `notification-fr.html` | Epick'em — Notifications FR | `notification-fr` |
| `notification-en.html` | Epick'em — Notifications EN | `notification-en` |
| `notification-es.html` | Epick'em — Notifications ES | `notification-es` |

Set the subject to `{{{TITLE}}}`. The backend also overrides the subject with
the localized title. Use the verified sender configured by `MAIL_FROM`.

Declare `TITLE` and `BODY` as string variables, without default values, in each
template. They are the only placeholders used by these HTML files. The backend
already translates their content; the templates translate the surrounding copy.
Do not add `USERNAME`: notification emails do not receive it.

The backend also sends `CATEGORY`, `LANGUAGE` and `ACTION_URL` as strings. These
may be declared as string variables for parity with the payload, but are not
displayed by these templates.

## Current backend incompatibility

`notification_variables` in `backend/crates/api-public/src/mail.rs` also sends
`HAS_ACTION` as a boolean. Resend documents only string and number template
variables: https://resend.com/docs/api-reference/templates/create-template

Remove `HAS_ACTION` from the backend payload and update its tests/documentation
before validating real delivery. These templates do not require that field.
Importing the HTML alone does not resolve the incompatible payload. This template
delivery does not modify the backend.

## Local links and configuration

Every button points to `http://localhost:3000`, the local web homepage. This
also works for team events, whose `ACTION_URL` is empty. There are no conditional
blocks or empty action links. The buttons deliberately do not use `ACTION_URL`.

```dotenv
PUBLIC_URL=http://localhost:3000
RESEND_NOTIFICATION_TEMPLATE_FR=notification-fr
RESEND_NOTIFICATION_TEMPLATE_EN=notification-en
RESEND_NOTIFICATION_TEMPLATE_ES=notification-es
```

Set `RESEND_API_KEY` and `MAIL_FROM` on the backend as usual, then recreate the
API container after changing its environment. Keep secrets out of HTML files.
Changing `PUBLIC_URL` later does not update the fixed buttons: edit and republish
all three templates when the web origin changes.

Open these links on the computer running the web application. On a phone,
localhost refers to the phone itself.

## Preview values

| Alias | TITLE | BODY |
| --- | --- | --- |
| `notification-fr` | Le tournoi Demo Cup commence | Demo Cup vient de démarrer. Bonne chance ! |
| `notification-en` | Demo Cup has started | Demo Cup has just started. Good luck! |
| `notification-es` | Demo Cup ha comenzado | Demo Cup acaba de comenzar. ¡Buena suerte! |

These three templates cover tournament start/end/cancellation/disqualification,
team member addition/removal, and match start/end. No per-event templates are
needed. The existing `password-reset`, `email-address-confirmation` and
`welcome-account` templates remain unchanged.
