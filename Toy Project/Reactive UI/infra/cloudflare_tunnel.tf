# Cloudflare Tunnel: the VM opens an outbound connection to Cloudflare, so no
# inbound HTTP(S) port is needed and the origin IP stays hidden.
# Remotely managed (config_src = "cloudflare"): routing lives here, the VM only
# needs the tunnel token (see deploy/compose.yaml).
locals {
  origin_service = "http://web:80" # compose service reachable from the cloudflared container
  web_hostnames  = [var.domain, "www.${var.domain}"]
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "web" {
  account_id = var.cloudflare_account_id
  name       = "reactive-ui"
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "web" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.web.id

  config = {
    ingress = concat(
      [for h in local.web_hostnames : { hostname = h, service = local.origin_service }],
      [{ service = "http_status:404" }], # catch-all (required last rule)
    )
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "web" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.web.id
}

resource "cloudflare_dns_record" "web" {
  for_each = toset(local.web_hostnames)

  zone_id = cloudflare_zone.main.id
  name    = each.value
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.web.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # automatic (required for proxied records)
  comment = "Cloudflare Tunnel: reactive-ui"
}

# HTTPS-only with modern TLS at the edge.
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = cloudflare_zone.main.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = cloudflare_zone.main.id
  setting_id = "min_tls_version"
  value      = "1.2"
}
