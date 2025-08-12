# Actual values for deployment
# OCI Authentication (required)
tenancy_ocid     = "ocid1.tenancy.oc1.*"
user_ocid        = "ocid1.user.oc1.*"
fingerprint      = "*"
private_key_path = "~/.oci/oci_api_key.pem"
compartment_ocid = "ocid1.tenancy.oc1.*"

# Region
region = "ap-chuncheon-1"

# Project Configuration
project_name = "chat-service"
environment  = "prod"

# Network Configuration
vcn_cidr_block     = "10.0.0.0/16"
public_subnet_cidr = "10.0.1.0/24"

# Compute Configuration (Ampere A1 Flex free tier limits)
instance_shape          = "VM.Standard.A1.Flex"
instance_ocpus          = 4
instance_memory_in_gbs  = 24
boot_volume_size_in_gbs = 50

# SSH Key
ssh_public_key = "ssh-rsa * junhyung@jhcho"

# TLS/HTTPS Configuration - Let's Encrypt
use_letsencrypt    = true
letsencrypt_domain = "www.junhyung.xyz"
letsencrypt_email  = "admin@junhyung.xyz"
