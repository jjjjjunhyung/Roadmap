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
