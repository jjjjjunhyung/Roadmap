# DNS zone for the domain (Cloudflare Free plan).
# After the first apply, set the registrar (Gabia) name servers to `cloudflare_name_servers`.
resource "cloudflare_zone" "main" {
  account = {
    id = var.cloudflare_account_id
  }
  name = var.domain
  type = "full"

  lifecycle {
    prevent_destroy = true
  }
}
