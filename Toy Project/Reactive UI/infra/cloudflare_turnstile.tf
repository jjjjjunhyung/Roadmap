# Cloudflare Turnstile (free) in front of the birthday form at /: scripts that try many
# birthdays from many addresses must pass a bot check on every guess. "managed" lets
# Cloudflare decide; the page renders it "interaction-only", so people rarely see it.
# The site key is public (it sits in the page); the secret stays in the VM .env
# (TURNSTILE_SITE_KEY / TURNSTILE_SECRET, from the outputs below).
# Needs the API token to include Account > Turnstile > Edit.
resource "cloudflare_turnstile_widget" "archive" {
  account_id = var.cloudflare_account_id
  name       = "reactive-ui archive"
  domains    = [var.domain] # also covers subdomains such as www
  mode       = "managed"
}
