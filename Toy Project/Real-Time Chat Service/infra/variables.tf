# OCI Authentication
variable "tenancy_ocid" {
  description = "The OCID of the tenancy"
  type        = string
}

variable "user_ocid" {
  description = "The OCID of the user"
  type        = string
}

variable "fingerprint" {
  description = "The fingerprint of the public key"
  type        = string
}

variable "private_key_path" {
  description = "The path to the private key file"
  type        = string
}

variable "region" {
  description = "The OCI region"
  type        = string
  default     = "ap-chuncheon-1"
}

variable "compartment_ocid" {
  description = "The OCID of the compartment to create resources in"
  type        = string
}

# Project Configuration
variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "chat-service"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

# Network Configuration
variable "vcn_cidr_block" {
  description = "CIDR block for the VCN"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR block for the public subnet"
  type        = string
  default     = "10.0.1.0/24"
}

# Compute Configuration
variable "instance_shape" {
  description = "The shape of the compute instance"
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "instance_ocpus" {
  description = "Number of OCPUs for the instance"
  type        = number
  default     = 2
}

variable "instance_memory_in_gbs" {
  description = "Amount of memory in GBs for the instance"
  type        = number
  default     = 12
}

variable "boot_volume_size_in_gbs" {
  description = "Boot volume size in GBs"
  type        = number
  default     = 50
}

# SSH Key
variable "ssh_public_key" {
  description = "SSH public key for the compute instance"
  type        = string
}

variable "ssh_private_key_path" {
  description = "Path to SSH private key file for connecting to the compute instance"
  type        = string
  default     = "~/.ssh/chat_vm"
}

# Let's Encrypt TLS/HTTPS Configuration
variable "use_letsencrypt" {
  description = "Whether to use Let's Encrypt certificates generated on the instance"
  type        = bool
  default     = true
}

variable "letsencrypt_domain" {
  description = "Domain name for Let's Encrypt certificate"
  type        = string
  default     = "www.junhyung.xyz"
}

variable "letsencrypt_email" {
  description = "Email address for Let's Encrypt registration"
  type        = string
  default     = "admin@junhyung.xyz"
}

variable "letsencrypt_cert_content" {
  description = "Content of Let's Encrypt certificate (for updates after generation)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "letsencrypt_key_content" {
  description = "Content of Let's Encrypt private key (for updates after generation)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "letsencrypt_chain_content" {
  description = "Content of Let's Encrypt chain certificate (for updates after generation)"
  type        = string
  default     = ""
  sensitive   = true
}
