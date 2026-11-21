# One-time bootstrap: Object Storage bucket that holds the main workspace's state.
# This root keeps its own (small) state locally; if it is ever lost, re-import the bucket:
#   terraform import oci_objectstorage_bucket.tfstate n/<namespace>/b/<bucket_name>
terraform {
  required_version = ">= 1.12"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.14"
    }
  }
}

provider "oci" {
  config_file_profile = var.oci_profile
}

data "oci_objectstorage_namespace" "this" {
  compartment_id = var.tenancy_ocid
}

resource "oci_objectstorage_bucket" "tfstate" {
  compartment_id = var.tenancy_ocid
  namespace      = data.oci_objectstorage_namespace.this.namespace
  name           = var.bucket_name
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Enabled" # keep previous state versions for recovery

  freeform_tags = {
    ManagedBy = "terraform"
    Project   = "reactive-ui"
    Purpose   = "terraform-state"
  }

  lifecycle {
    prevent_destroy = true
  }
}
