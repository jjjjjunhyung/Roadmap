variable "oci_profile" {
  description = "Profile name in ~/.oci/config"
  type        = string
  default     = "DEFAULT"
}

variable "tenancy_ocid" {
  description = "Tenancy OCID (root compartment)"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "domain" {
  description = "Apex domain served through Cloudflare"
  type        = string
}

variable "ssh_public_key" {
  description = "SSH public key for the ubuntu user (only applied at instance launch)"
  type        = string
}
