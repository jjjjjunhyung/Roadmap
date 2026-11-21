provider "oci" {
  config_file_profile = var.oci_profile
}

# Reads the API token from the CLOUDFLARE_API_TOKEN environment variable
# (exported in ~/.zshrc from the macOS Keychain entry "cloudflare-api-token").
provider "cloudflare" {}
