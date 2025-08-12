# VCN and Networking Resources
resource "oci_core_vcn" "chat_vcn" {
  compartment_id = var.compartment_ocid
  cidr_block     = var.vcn_cidr_block
  display_name   = "${local.name_prefix}-vcn"
  dns_label      = local.dns_label

  freeform_tags = local.network_tags
}

resource "oci_core_internet_gateway" "chat_igw" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.chat_vcn.id
  display_name   = "${local.name_prefix}-igw"
  enabled        = true

  freeform_tags = local.network_tags
}

# Public subnet routing
resource "oci_core_route_table" "public_route_table" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.chat_vcn.id
  display_name   = "${local.name_prefix}-public-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.chat_igw.id
  }

  freeform_tags = local.network_tags
}

# Public subnet for compute instances and load balancer
resource "oci_core_subnet" "public_subnet" {
  compartment_id      = var.compartment_ocid
  vcn_id              = oci_core_vcn.chat_vcn.id
  cidr_block          = var.public_subnet_cidr
  display_name        = "${local.name_prefix}-public-subnet"
  dns_label           = "public"
  security_list_ids   = [oci_core_security_list.public_security_list.id]
  route_table_id      = oci_core_route_table.public_route_table.id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name

  prohibit_public_ip_on_vnic = false

  freeform_tags = merge(local.network_tags, {
    Type = "public"
  })
}
