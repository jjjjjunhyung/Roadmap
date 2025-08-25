#!/bin/bash

# Let's Encrypt Certificate Update Script for OCI Load Balancer
# This script helps automate the process of updating the load balancer with fresh Let's Encrypt certificates

set -e

# Configuration
TERRAFORM_DIR="/Users/junhyung/chat/infra"
INSTANCE_KEY="$HOME/.ssh/oci_chat_service"
TEMP_CERT_DIR="/tmp/letsencrypt_certs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if [[ ! -f "$INSTANCE_KEY" ]]; then
        log_error "SSH key not found: $INSTANCE_KEY"
        log_info "Please ensure you have the correct SSH key for the instance"
        exit 1
    fi
    
    if [[ ! -d "$TERRAFORM_DIR" ]]; then
        log_error "Terraform directory not found: $TERRAFORM_DIR"
        exit 1
    fi
    
    if ! command -v terraform &> /dev/null; then
        log_error "Terraform is not installed"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Get instance IP from Terraform output
get_instance_ip() {
    log_info "Getting instance IP from Terraform output..."
    cd "$TERRAFORM_DIR"
    
    INSTANCE_IP=$(terraform output -raw compute_instance_public_ip 2>/dev/null)
    if [[ -z "$INSTANCE_IP" ]]; then
        log_error "Could not get instance IP from Terraform output"
        log_info "Make sure the infrastructure is deployed: terraform apply"
        exit 1
    fi
    
    log_success "Instance IP: $INSTANCE_IP"
}

# Download certificates from instance
download_certificates() {
    log_info "Downloading Let's Encrypt certificates from instance..."
    
    # Create temp directory
    mkdir -p "$TEMP_CERT_DIR"
    
    # Check if certificates exist on instance
    if ! ssh -i "$INSTANCE_KEY" -o StrictHostKeyChecking=no ubuntu@"$INSTANCE_IP" "[ -d /opt/letsencrypt ] && [ -f /opt/letsencrypt/cert.pem ]"; then
        log_error "Let's Encrypt certificates not found on instance"
        log_info "Please wait for the certificate generation to complete or check the setup log:"
        log_info "ssh -i $INSTANCE_KEY ubuntu@$INSTANCE_IP 'tail -f /var/log/letsencrypt-setup.log'"
        exit 1
    fi
    
    # Download certificates
    log_info "Downloading certificate files..."
    scp -i "$INSTANCE_KEY" -o StrictHostKeyChecking=no ubuntu@"$INSTANCE_IP":/opt/letsencrypt/* "$TEMP_CERT_DIR/"
    
    # Verify certificate files
    if [[ ! -f "$TEMP_CERT_DIR/cert.pem" ]] || [[ ! -f "$TEMP_CERT_DIR/privkey.pem" ]]; then
        log_error "Required certificate files not found after download"
        exit 1
    fi
    
    log_success "Certificates downloaded to $TEMP_CERT_DIR"
    
    # Show certificate info
    log_info "Certificate information:"
    openssl x509 -in "$TEMP_CERT_DIR/cert.pem" -text -noout | grep -E "(Subject:|Issuer:|Not Before|Not After)" | head -4
}

# Update Terraform with new certificates
update_terraform() {
    log_info "Updating Terraform configuration with new certificates..."
    cd "$TERRAFORM_DIR"
    
    # Read certificate contents
    CERT_CONTENT=$(cat "$TEMP_CERT_DIR/cert.pem")
    KEY_CONTENT=$(cat "$TEMP_CERT_DIR/privkey.pem")
    CHAIN_CONTENT=""
    
    if [[ -f "$TEMP_CERT_DIR/chain.pem" ]]; then
        CHAIN_CONTENT=$(cat "$TEMP_CERT_DIR/chain.pem")
    fi
    
    # Create variables file for certificate update
    cat > terraform.tfvars.letsencrypt << EOF
# Let's Encrypt certificate content (auto-generated)
letsencrypt_cert_content = <<EOT
${CERT_CONTENT}
EOT

letsencrypt_key_content = <<EOT
${KEY_CONTENT}
EOT

letsencrypt_chain_content = <<EOT
${CHAIN_CONTENT}
EOT
EOF
    
    log_success "Certificate content written to terraform.tfvars.letsencrypt"
    
    # Apply Terraform with new certificates
    log_info "Applying Terraform configuration with updated certificates..."
    terraform apply -var-file="terraform.tfvars.letsencrypt" -auto-approve
    
    if [[ $? -eq 0 ]]; then
        log_success "Load balancer certificates updated successfully!"
        
        # Show HTTPS URL
        echo ""
        log_success "🔒 HTTPS is now available at: https://www.junhyung.xyz"
        log_info "It may take a few minutes for the load balancer to start using the new certificates"
        
        # Clean up
        rm -f terraform.tfvars.letsencrypt
        rm -rf "$TEMP_CERT_DIR"
        
    else
        log_error "Failed to apply Terraform configuration"
        log_warning "Certificate files are saved in: $TEMP_CERT_DIR"
        exit 1
    fi
}

# Main function
main() {
    echo "🔒 Let's Encrypt Certificate Update Script for OCI Load Balancer"
    echo ""
    
    check_prerequisites
    get_instance_ip
    download_certificates
    update_terraform
    
    echo ""
    log_success "🎉 Certificate update completed successfully!"
    log_info "Your site should now have a valid SSL certificate from Let's Encrypt"
    log_info "Auto-renewal is configured on the instance for certificate management"
}

# Show help
show_help() {
    echo "Let's Encrypt Certificate Update Script"
    echo ""
    echo "This script downloads Let's Encrypt certificates from your OCI instance"
    echo "and updates the load balancer configuration to use them."
    echo ""
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  update     Update load balancer with Let's Encrypt certificates (default)"
    echo "  help       Show this help message"
    echo ""
    echo "Prerequisites:"
    echo "  - OCI infrastructure deployed with Terraform"
    echo "  - SSH key available at ~/.ssh/oci_chat_service"
    echo "  - Let's Encrypt certificates generated on instance"
    echo ""
    echo "Example:"
    echo "  $0 update    # Update certificates"
}

# Parse arguments
case "${1:-update}" in
    "update")
        main
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        log_error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac