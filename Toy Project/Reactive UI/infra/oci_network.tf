data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

resource "oci_core_vcn" "main" {
  compartment_id = var.tenancy_ocid
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "${local.name_prefix}-vcn"
  dns_label      = local.legacy_vcn_dns_label # immutable

  freeform_tags = merge(local.common_tags, { Type = "network" })
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name_prefix}-igw"
  enabled        = true

  freeform_tags = merge(local.common_tags, { Type = "network" })
}

resource "oci_core_route_table" "public" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name_prefix}-public-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }

  freeform_tags = merge(local.common_tags, { Type = "network" })
}

# Inbound traffic is controlled by the NSG below; the security list only allows egress.
resource "oci_core_security_list" "public" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name_prefix}-public-sl"

  egress_security_rules {
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    protocol         = "all"
    description      = "Allow all outbound traffic"
  }

  freeform_tags = merge(local.common_tags, { Type = "public" })
}

resource "oci_core_subnet" "public" {
  compartment_id      = var.tenancy_ocid
  vcn_id              = oci_core_vcn.main.id
  cidr_block          = "10.0.1.0/24"
  display_name        = "${local.name_prefix}-public-subnet"
  dns_label           = "public" # immutable
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  route_table_id      = oci_core_route_table.public.id
  security_list_ids   = [oci_core_security_list.public.id]

  prohibit_public_ip_on_vnic = false

  freeform_tags = merge(local.common_tags, { Type = "public" })
}

resource "oci_core_network_security_group" "server" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name_prefix}-nsg"

  freeform_tags = merge(local.common_tags, { Type = "network" })
}

resource "oci_core_network_security_group_security_rule" "server_egress_all" {
  network_security_group_id = oci_core_network_security_group.server.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "All outbound traffic"
}

resource "oci_core_network_security_group_security_rule" "server_ingress_ssh" {
  network_security_group_id = oci_core_network_security_group.server.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "SSH access"

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}
