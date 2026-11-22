output "cloudflare_zone_id" {
  value = cloudflare_zone.main.id
}

output "cloudflare_zone_status" {
  description = "pending until the registrar name servers point at Cloudflare, then active"
  value       = cloudflare_zone.main.status
}

output "cloudflare_name_servers" {
  description = "Set these as the name servers for the domain at Gabia"
  value       = cloudflare_zone.main.name_servers
}

output "server_public_ip" {
  value = oci_core_public_ip.server.ip_address
}

output "server_private_ip" {
  value = data.oci_core_private_ips.server.private_ips[0].ip_address
}

output "tunnel_id" {
  value = cloudflare_zero_trust_tunnel_cloudflared.web.id
}

output "tunnel_token" {
  description = "Goes into TUNNEL_TOKEN in the VM's deploy/.env (never commit it)"
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.web.token
  sensitive   = true
}

output "site_url" {
  description = "Used by deploy.sh for the post-deploy health check"
  value       = "https://${var.domain}"
}

output "turnstile_site_key" {
  description = "Goes into TURNSTILE_SITE_KEY in the VM's .env (public: it is sent to the page)"
  value       = cloudflare_turnstile_widget.archive.sitekey
}

output "turnstile_secret" {
  description = "Goes into TURNSTILE_SECRET in the VM's .env (never commit it)"
  value       = cloudflare_turnstile_widget.archive.secret
  sensitive   = true
}

output "backup_bucket" {
  value = oci_objectstorage_bucket.backups.name
}

output "backup_url" {
  description = "Goes into BACKUP_URL in the VM's .env: write-only upload prefix (never commit it)"
  value       = "https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.backup_upload.access_uri}"
  sensitive   = true
}
