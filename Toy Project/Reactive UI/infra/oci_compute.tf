data "oci_core_images" "ubuntu" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# Always Free Ampere A1: 2 OCPU / 12 GB (limit effective 2026-06-15).
resource "oci_core_instance" "server" {
  compartment_id      = var.tenancy_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "${local.legacy_prefix}-server"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id                 = oci_core_subnet.public.id
    display_name              = "${local.legacy_prefix}-vnic"
    hostname_label            = "chat-server" # immutable
    assign_public_ip          = false         # the reserved IP below is attached instead
    assign_private_dns_record = true
    nsg_ids                   = [oci_core_network_security_group.server.id]
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }

  freeform_tags = merge(local.legacy_tags, { Type = "compute" })

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      source_details[0].source_id, # newer images must not trigger a rebuild
      metadata,                    # ssh key / user_data are fixed at launch
      # Launch-only VNIC flags that the provider cannot read back after import
      # (assign_private_dns_record forces replacement if it appears to differ).
      create_vnic_details[0].assign_private_dns_record,
      create_vnic_details[0].assign_public_ip,
    ]
  }
}

resource "oci_core_volume" "data" {
  compartment_id      = var.tenancy_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "${local.legacy_prefix}-data-volume"
  size_in_gbs         = 100 # boot 50 + data 100 = 150 of the 200 GB Always Free block storage

  freeform_tags = merge(local.legacy_tags, { Type = "storage" })

  lifecycle {
    prevent_destroy = true
  }
}

resource "oci_core_volume_attachment" "data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.server.id
  volume_id       = oci_core_volume.data.id
  display_name    = "${local.legacy_prefix}-data-attachment"
  device          = "/dev/oracleoci/oraclevdb"
}

data "oci_core_vnic_attachments" "server" {
  compartment_id = var.tenancy_ocid
  instance_id    = oci_core_instance.server.id
}

data "oci_core_private_ips" "server" {
  vnic_id = data.oci_core_vnic_attachments.server.vnic_attachments[0].vnic_id
}

# Reserved public IP: SSH access and outbound internet for the VM.
resource "oci_core_public_ip" "server" {
  compartment_id = var.tenancy_ocid
  display_name   = "${local.legacy_prefix}-public-ip"
  lifetime       = "RESERVED"
  private_ip_id  = data.oci_core_private_ips.server.private_ips[0].id

  freeform_tags = merge(local.legacy_tags, { Type = "compute" })

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [private_ip_id]
  }
}
