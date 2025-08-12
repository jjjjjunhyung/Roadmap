# Ampere A1 Flex compute instance with Ubuntu 24.04 LTS
resource "oci_core_instance" "chat_server" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "${local.name_prefix}-server"
  shape               = var.instance_shape

  # Ampere A1 Flex configuration
  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_in_gbs
  }

  # Boot volume configuration
  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_size_in_gbs
  }

  # Network configuration
  create_vnic_details {
    subnet_id                 = oci_core_subnet.public_subnet.id
    display_name              = "${local.name_prefix}-vnic"
    assign_public_ip          = false
    assign_private_dns_record = true
    hostname_label            = "chat-server"
    nsg_ids                   = [oci_core_network_security_group.chat_nsg.id]
  }

  # SSH key configuration
  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
      project_name = var.project_name
      environment  = var.environment
    }))
  }

  # Fault domain (optional for high availability)
  fault_domain = data.oci_identity_fault_domains.fds.fault_domains[0].name

  freeform_tags = local.compute_tags

  # Prevent accidental termination
  lifecycle {
    ignore_changes = [
      source_details[0].source_id,
    ]
  }
}

# Additional Block Volume (for Docker data and persistent storage)
resource "oci_core_volume" "chat_data_volume" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "${local.name_prefix}-data-volume"
  size_in_gbs         = 100 # Increased for Docker images and data

  freeform_tags = local.storage_tags
}

# Attach block volume to instance
resource "oci_core_volume_attachment" "chat_data_volume_attachment" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.chat_server.id
  volume_id       = oci_core_volume.chat_data_volume.id
  display_name    = "${local.name_prefix}-data-attachment"

  # Use consistent device path
  device = "/dev/oracleoci/oraclevdb"
}

# Reserved Public IP attached to instance
resource "oci_core_public_ip" "chat_server_public_ip" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-public-ip"
  lifetime       = "RESERVED"
  private_ip_id  = data.oci_core_private_ips.chat_server_private_ips.private_ips[0].id

  freeform_tags = local.compute_tags
}
