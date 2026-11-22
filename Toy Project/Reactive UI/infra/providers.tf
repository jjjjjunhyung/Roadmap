provider "oci" {
  config_file_profile = var.oci_profile
}

# Reads the API token from the CLOUDFLARE_API_TOKEN environment variable
# (exported in ~/.zshrc from the macOS Keychain entry "cloudflare-api-token").
provider "cloudflare" {}

# CloudFront (and its certificate, which must live in us-east-1) for a front door in Seoul.
# Short-lived credentials from IAM Identity Center: run `aws sso login --profile <aws_profile>`
# first; the role only covers CloudFront, ACM in us-east-1 and Budgets.
provider "aws" {
  region  = "us-east-1"
  profile = var.aws_profile
}
