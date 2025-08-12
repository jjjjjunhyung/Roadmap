# Infrastructure Resource IDs
output "vcn_id" {
  description = "OCID of the VCN"
  value       = oci_core_vcn.chat_vcn.id
}

output "public_subnet_id" {
  description = "OCID of the public subnet"
  value       = oci_core_subnet.public_subnet.id
}

output "internet_gateway_id" {
  description = "OCID of the internet gateway"
  value       = oci_core_internet_gateway.chat_igw.id
}

# Compute instance details
output "compute_instance_id" {
  description = "OCID of the compute instance"
  value       = oci_core_instance.chat_server.id
}

output "compute_instance_public_ip" {
  description = "Public IP address of the compute instance"
  value       = oci_core_public_ip.chat_server_public_ip.ip_address
}

output "compute_instance_private_ip" {
  description = "Private IP address of the compute instance"
  value       = oci_core_instance.chat_server.private_ip
}

# Reserved Public IP Output
output "reserved_public_ip" {
  description = "Reserved public IP address"
  value       = oci_core_public_ip.chat_server_public_ip.ip_address
}

# Load balancer details
output "load_balancer_id" {
  description = "OCID of the load balancer"
  value       = oci_load_balancer_load_balancer.chat_lb.id
}

output "load_balancer_public_ip" {
  description = "Public IP address of the load balancer"
  value       = oci_load_balancer_load_balancer.chat_lb.ip_address_details[0].ip_address
}

# Container registry information
output "container_registry_url" {
  description = "URL of the container registry in the region"
  value       = "${var.region}.ocir.io"
}

output "container_repository_app" {
  description = "Full path to the app container repository"
  value       = "${var.region}.ocir.io/${data.oci_objectstorage_namespace.tenancy_namespace.namespace}/${oci_artifacts_container_repository.chat_repo.display_name}"
}

# Connection and access information
output "ssh_connection_command" {
  description = "SSH connection command for the compute instance"
  value       = "ssh -i ${var.private_key_path} ubuntu@${oci_core_public_ip.chat_server_public_ip.ip_address}"
}

output "application_url" {
  description = "Application URL via load balancer"
  value       = "http://${oci_load_balancer_load_balancer.chat_lb.ip_address_details[0].ip_address}"
}

output "application_https_url" {
  description = "HTTPS Application URL"
  value       = "https://www.junhyung.xyz"
}

# Let's Encrypt certificate information
output "letsencrypt_setup_instructions" {
  description = "Instructions for Let's Encrypt certificate setup"
  value = var.use_letsencrypt ? [
    "1. Wait 5 minutes after instance launch for Let's Encrypt setup to start",
    "2. Check progress: ssh -i ${var.private_key_path} ubuntu@${oci_core_public_ip.chat_server_public_ip.ip_address} 'tail -f /var/log/letsencrypt-setup.log'",
    "3. Certificates will be stored in /opt/letsencrypt/ on the instance",
    "4. Auto-renewal is configured for every Sunday at 2 AM",
    "5. Load balancer will initially use placeholder certificates until Let's Encrypt setup completes"
  ] : []
}

output "certificate_update_instructions" {
  description = "Instructions for updating load balancer with Let's Encrypt certificates"
  value = var.use_letsencrypt ? [
    "After Let's Encrypt certificates are generated:",
    "1. Copy certificates from instance: scp -i ${var.private_key_path} ubuntu@${oci_core_public_ip.chat_server_public_ip.ip_address}:/opt/letsencrypt/* ./",
    "2. Update terraform variables with certificate content",
    "3. Run: terraform apply -var='letsencrypt_cert_content=<cert_content>' -var='letsencrypt_key_content=<key_content>'"
  ] : []
}
