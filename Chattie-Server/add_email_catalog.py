import json
import re
from pathlib import Path

templates = {
"welcome_email": ("Welcome to Chattie", "<h1>Welcome, {{.Username}}</h1><p>Your Chattie account is ready. Sign in to meet people and start conversations.</p>"),
"new_match": ("It is a match!", "<h1>You have a new match</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href=\"{{.ActionURL}}\">Open Chattie</a></p>"),
"new_message": ("You have a new Chattie message", "<h1>New message</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href=\"{{.ActionURL}}\">View message</a></p>"),
"data_dossier": ("Your Chattie data archive is ready", "<h1>Your Chattie archive is ready</h1><p>Hello {{.Username}}, your requested Chattie data archive is attached to this email.</p><p>If you did not request this, secure your account and contact support.</p>"),
"after_dark_data_archive": ("Your After Dark data archive is ready", "<h1>Your After Dark archive is ready</h1><p>Hello {{.Username}}, your requested After Dark data archive is attached. It contains information from your After Dark account only.</p><p>If you did not request this, secure your account and contact support.</p>"),
"unread_messages": ("You have unread messages", "<h1>Hello {{.Username}}</h1><p>You have unread messages waiting for you on Chattie.</p>"),
"miss_you": ("We miss you on Chattie", "<h1>We miss you, {{.Username}}</h1><p>Come back to Chattie when you are ready to connect again.</p>"),
"premium_welcome": ("Welcome to Chattie Premium", "<h1>Premium is active</h1><p>Hello {{.Username}}, your Premium upgrade was successful.</p><p>Plan duration: {{.Months}} month(s)</p>"),
"premium_payment_receipt": ("Chattie Premium payment receipt", "<h1>Payment received</h1><p>Hello {{.Username}}, your Premium payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Plan: {{.Months}} month(s)<br>Reference: {{.Reference}}<br>Payment date: {{.PaidAt}}</p>"),
"premium_action_required": ("Action needed for your Chattie Premium payment", "<h1>Payment needs attention</h1><p>Hello {{.Username}}, your Premium payment could not be completed.</p><p>{{.ActionMessage}}</p><p>Reference: {{.Reference}}</p>"),
"new_like": ("Someone noticed you on Chattie", "<h1>New profile interaction</h1><p>Hello {{.Username}}, someone interacted with your profile.</p><p><a href=\"{{.ActionURL}}\">View profile</a></p>"),
"report_received": ("We received your report", "<h1>Thank you, {{.Username}}</h1><p>Your report has been received and will be reviewed by our safety team.</p>"),
"account_banned": ("Account action notice", "<h1>Account notice</h1><p>Hello {{.Username}}, an account action was taken. Sign in to Chattie or contact support if you believe this is a mistake.</p>"),
"moderation_action": ("Moderation notice on your account", "<h1>Account notice</h1><p>Hello {{.Username}}, a moderation action was taken.</p><p>Reason: {{.Reason}}</p>"),
"operator_suspended": ("Operator account suspended", "<h1>Operator account notice</h1><p>Hello {{.Username}}, your operator account has been suspended.</p>"),
"otp_verification_email": ("Your Chattie verification code", "<h1>Your verification code</h1><p style=\"font-size:28px;font-weight:bold;letter-spacing:6px\">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. Do not share it with anyone.</p>"),
"login_2fa_email": ("Your Chattie sign-in code", "<h1>Confirm your sign-in</h1><p style=\"font-size:28px;font-weight:bold;letter-spacing:6px\">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not try to sign in, change your password.</p>"),
"password_reset_email": ("Reset your Chattie password", "<h1>Password reset code</h1><p style=\"font-size:28px;font-weight:bold;letter-spacing:6px\">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not request a reset, ignore this message.</p>"),
"two_factor_setup_email": ("Confirm your Chattie security change", "<h1>Confirm your security change</h1><p style=\"font-size:28px;font-weight:bold;letter-spacing:6px\">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not request this change, secure your account.</p>"),
"ad_creator_subscription": ("New After Dark subscriber", "<h1>New subscriber</h1><p>Hello {{.Username}}, {{.CustomerName}} subscribed to your creator account.</p>"),
"ad_creator_sale": ("New After Dark purchase", "<h1>New purchase</h1><p>Hello {{.Username}}, you received a new After Dark purchase.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Payment method: {{.PaymentMethod}}<br>Wallet contribution: KES {{.WalletContribution}}<br>Reference: {{.Reference}}</p>"),
"ad_creator_tip": ("You received an After Dark tip", "<h1>New tip</h1><p>Hello {{.Username}}, {{.CustomerName}} sent you a tip.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Reference: {{.Reference}}</p>"),
"ad_payment_receipt": ("After Dark payment receipt", "<h1>Payment received</h1><p>Hello {{.Username}}, your After Dark payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Payment method: {{.PaymentMethod}}<br>Wallet contribution: KES {{.WalletContribution}}<br>Item: {{.PaymentType}}<br>Reference: {{.Reference}}<br>Receipt: {{.ReceiptNumber}}<br>Payment date: {{.PaidAt}}</p>"),
"ad_action_required": ("Action needed for your After Dark payment", "<h1>Payment needs attention</h1><p>Hello {{.Username}}, your After Dark payment could not be completed.</p><p>{{.ActionMessage}}</p><p>Reference: {{.Reference}}</p>"),
"afterdark_notification": ("After Dark account notification", "<h1>{{.Title}}</h1><p>Hello {{.Username}}, {{.Message}}</p>"),
"room_approved": ("Your Chattie room request was approved", "<h1>Room request approved</h1><p>Hello {{.Username}}, your request to join a room was approved.</p><p><a href=\"{{.ActionURL}}\">Open room</a></p>"),
}

def pascal(name):
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[^A-Za-z0-9]+", name))

path = Path("locales/en.json")
catalog = json.loads(path.read_text(encoding="utf-8"))
catalog.update({
"ErrFailedFetchLanguage": "Failed to fetch language setting",
"ErrInvalidLanguagePayload": "Invalid language payload",
"ErrInvalidLanguage": "Invalid language",
"ErrFailedUpdateLanguage": "Failed to update language setting",
"MsgLanguageUpdated": "Language updated successfully",
})
for name, (subject, body) in templates.items():
    catalog["EmailSubject" + pascal(name)] = subject
    catalog["EmailBody" + pascal(name)] = body
path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
