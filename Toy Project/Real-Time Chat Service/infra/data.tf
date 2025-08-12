# Common data sources
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_identity_fault_domains" "fds" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
}

data "oci_core_services" "all_services" {}

# Ubuntu 24.04 LTS image for Ampere A1 Flex
data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# Container registry namespace
data "oci_objectstorage_namespace" "tenancy_namespace" {
  compartment_id = var.tenancy_ocid
}

data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.compartment_ocid
}

# Instance networking data sources
data "oci_core_vnic_attachments" "chat_server_vnic_attachments" {
  compartment_id = var.compartment_ocid
  instance_id    = oci_core_instance.chat_server.id
}

data "oci_core_private_ips" "chat_server_private_ips" {
  vnic_id = data.oci_core_vnic_attachments.chat_server_vnic_attachments.vnic_attachments[0].vnic_id
}
