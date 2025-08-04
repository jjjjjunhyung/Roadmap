# Network Outputs
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

# Compute Outputs
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

# Security Outputs
output "security_list_public_id" {
  description = "OCID of the public security list"
  value       = oci_core_security_list.public_security_list.id
}

# Load Balancer Outputs
output "load_balancer_id" {
  description = "OCID of the load balancer"
  value       = oci_load_balancer_load_balancer.chat_lb.id
}

output "load_balancer_public_ip" {
  description = "Public IP address of the load balancer"
  value       = oci_load_balancer_load_balancer.chat_lb.ip_address_details[0].ip_address
}

# Container Registry Outputs
output "container_registry_url" {
  description = "URL of the container registry in the region"
  value       = "${var.region}.ocir.io"
}

output "container_repository_app" {
  description = "Full path to the app container repository"
  value       = "${var.region}.ocir.io/${data.oci_objectstorage_namespace.tenancy_namespace.namespace}/${oci_artifacts_container_repository.chat_repo.display_name}"
}

# Connection Information
output "ssh_connection_command" {
  description = "SSH connection command for the compute instance"
  value       = "ssh -i ${var.private_key_path} ubuntu@${oci_core_public_ip.chat_server_public_ip.ip_address}"
}

output "application_url" {
  description = "Application URL via load balancer"
  value       = "http://${oci_load_balancer_load_balancer.chat_lb.ip_address_details[0].ip_address}"
}
