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
