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

variable "region" {
  description = "OCI region of the resources (as in ~/.oci/config), e.g. for service names in policies"
  type        = string
}

variable "aws_profile" {
  description = "AWS CLI profile (IAM Identity Center) used for CloudFront, ACM and Budgets"
  type        = string
  default     = "reactive-ui"
}

variable "budget_email" {
  description = "Where cost alerts go (AWS and OCI budgets)"
  type        = string
  sensitive   = true
}

variable "front_door" {
  description = "Who answers for the site's hostnames: \"cloudflare\" (proxy + tunnel) or \"cloudfront\" (CloudFront in Seoul, then the tunnel)"
  type        = string
  default     = "cloudflare"
  validation {
    condition     = contains(["cloudflare", "cloudfront"], var.front_door)
    error_message = "front_door must be \"cloudflare\" or \"cloudfront\"."
  }
}
