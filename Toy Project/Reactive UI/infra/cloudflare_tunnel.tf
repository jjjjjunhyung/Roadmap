# Cloudflare Tunnel: the VM opens an outbound connection to Cloudflare, so no
# inbound HTTP(S) port is needed and the origin IP stays hidden.
# Remotely managed (config_src = "cloudflare"): routing lives here, the VM only
# needs the tunnel token (see deploy/compose.yaml).
locals {
  origin_service = "http://web:8080" # compose service "web" (Rust server) seen from cloudflared
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
      [for h in concat(local.web_hostnames, [local.origin_hostname]) : { hostname = h, service = local.origin_service }],
      [{ service = "http_status:404" }], # catch-all (required last rule)
    )
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "web" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.web.id
}

# The public hostnames: through Cloudflare's proxy to the tunnel, or (front_door = "cloudfront")
# to CloudFront in Seoul, DNS only (the apex CNAME is flattened by Cloudflare).
resource "cloudflare_dns_record" "web" {
  for_each = toset(local.web_hostnames)

  zone_id = cloudflare_zone.main.id
  name    = each.value
  type    = "CNAME"
  content = var.front_door == "cloudfront" ? aws_cloudfront_distribution.web.domain_name : "${cloudflare_zero_trust_tunnel_cloudflared.web.id}.cfargotunnel.com"
  proxied = var.front_door != "cloudfront"
  ttl     = var.front_door == "cloudfront" ? 300 : 1 # 1 = automatic (required when proxied)
  comment = var.front_door == "cloudfront" ? "CloudFront (Seoul front door)" : "Cloudflare Tunnel: reactive-ui"
}

# CloudFront's way in: proxied by Cloudflare (Seoul PoP for datacenter networks) to the tunnel.
resource "cloudflare_dns_record" "origin" {
  zone_id = cloudflare_zone.main.id
  name    = local.origin_hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.web.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "Origin for CloudFront -> Cloudflare Tunnel"
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
