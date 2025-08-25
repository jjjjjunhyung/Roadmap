FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create a simple index page
RUN echo '<!DOCTYPE html>' > /usr/share/nginx/html/index.html && \
    echo '<html><head><title>Chat Service</title></head>' >> /usr/share/nginx/html/index.html && \
    echo '<body><h1>Chat Service Nginx</h1>' >> /usr/share/nginx/html/index.html && \
    echo '<p>Nginx is running successfully!</p>' >> /usr/share/nginx/html/index.html && \
    echo '</body></html>' >> /usr/share/nginx/html/index.html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]