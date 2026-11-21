variable "tenancy_ocid" {
  description = "Tenancy OCID (the bucket lives in the root compartment)"
  type        = string
}

variable "oci_profile" {
  description = "Profile name in ~/.oci/config"
  type        = string
  default     = "DEFAULT"
}

variable "bucket_name" {
  description = "Object Storage bucket for Terraform state"
  type        = string
  default     = "terraform-state"
}
