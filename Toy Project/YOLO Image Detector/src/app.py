import os
import cv2
import numpy as np
import gradio as gr
import onnxruntime
import subprocess
import sys
from datetime import datetime
import json
import pandas as pd
import uuid
import shutil
import logging

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("gradio_app")

# Constants
MODEL_PATH = "yolov5m.onnx"
INPUT_WIDTH = 640
INPUT_HEIGHT = 640
USER_LOG_FILE = "user_activity_log.json"


def ensure_model_exists():
    """Convert PyTorch model to ONNX if needed"""
    if not os.path.exists(MODEL_PATH):
        logger.info("ONNX model file does not exist. Converting from PyTorch...")
        
        # Install required packages
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", 
            "torch", "torchvision", "onnx", "gitpython"
        ])
        
        # Clone yolov5 repository if needed
        if not os.path.exists("yolov5"):
            subprocess.check_call([
                "git", "clone", "https://github.com/ultralytics/yolov5.git"
            ])
        
        # Run conversion script
        script = """
import torch
import onnx
from pathlib import Path

# Load YOLOv5 model
model = torch.hub.load('ultralytics/yolov5', 'yolov5m', pretrained=True)
model.eval()

# Export to ONNX
dummy_input = torch.zeros(1, 3, 640, 640)
torch.onnx.export(
    model.model, 
    dummy_input, 
    'yolov5m.onnx',
    opset_version=12, 
    input_names=['images'], 
    output_names=['output'], 
    dynamic_axes={'images': {0: 'batch'}, 'output': {0: 'batch'}}
)
print("ONNX model conversion complete!")
"""
        subprocess.check_call([sys.executable, "-c", script])
        logger.info("ONNX model preparation complete!")


# Load COCO class names
CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", 
    "truck", "boat", "traffic light", "fire hydrant", "stop sign", 
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", 
    "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", 
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", 
    "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", 
    "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", 
    "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", 
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", 
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", 
    "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", 
    "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", 
    "scissors", "teddy bear", "hair drier", "toothbrush"
]

# Colors for visualization
COLORS = np.random.uniform(0, 255, size=(len(CLASSES), 3))


def normalize_filename(image_path):
    """Create a copy of the image with a normalized filename"""
    if not os.path.exists(image_path):
        logger.error(f"Error: File not found at {image_path}")
        return image_path

    # Get the directory and filename
    directory = os.path.dirname(image_path)
    extension = os.path.splitext(image_path)[1]

    # Create a new filename with a UUID
    new_filename = f"{str(uuid.uuid4())}{extension}"
    new_path = os.path.join(directory, new_filename)

    # Copy the file with the new name
    try:
        shutil.copy2(image_path, new_path)
        logger.info(f"File normalized: {image_path} -> {new_path}")
        
        # Set file permissions
        os.chmod(new_path, 0o644)
        return new_path
    except Exception as e:
        logger.error(f"Error normalizing filename: {e}")
        return image_path


def preprocess_image(image):
    """Preprocess image for YOLO model"""
    logger.info(f"Image input type: {type(image)}")

    # For file path inputs, normalize the filename
    if isinstance(image, str):
        logger.info(f"Processing image path: {image}")
        # Check if file exists
        if not os.path.exists(image):
            logger.error(f"Error: Image file not found at {image}")
            raise FileNotFoundError(f"Image file not found: {image}")

        try:
            # Load image directly with OpenCV
            img = cv2.imread(image)
            if img is None:
                logger.error(
                    f"Error: Unable to read image with OpenCV from {image}"
                )
                # Check file contents
                with open(image, 'rb') as f:
                    header = f.read(20)  # Read first 20 bytes of the file
                    logger.info(f"File header (hex): {header.hex()}")
                raise ValueError(f"Unable to read image with OpenCV: {image}")

            # Convert BGR to RGB
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            logger.info(f"Image loaded successfully: {image}, shape: {img.shape}")
        except Exception as e:
            logger.error(f"Error loading image from path: {e}")
            raise
    elif isinstance(image, np.ndarray):
        # For OpenCV image (BGR format)
        logger.info(f"NumPy array input shape: {image.shape}")
        if image.shape[2] == 3:
            # Convert BGR to RGB
            img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        elif image.shape[2] == 4:  # RGBA
            # Convert RGBA to RGB
            img = cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)
    else:
        # For PIL image (already in RGB format)
        logger.info(f"PIL Image or other type: {type(image)}")
        try:
            img = np.array(image)
            logger.info(f"Converted to NumPy array, shape: {img.shape}")
            if img.shape[2] == 4:  # RGBA
                img = img[:, :, :3]  # Remove alpha channel
        except Exception as e:
            logger.error(f"Error converting image to NumPy array: {e}")
            raise
    
    # Resize and normalize
    try:
        blob = cv2.dnn.blobFromImage(
            img, 1/255.0, (INPUT_WIDTH, INPUT_HEIGHT), 
            swapRB=False, crop=False
        )
        return blob, img
    except Exception as e:
        logger.error(f"Error in blobFromImage: {e}")
        raise


def detect_objects(image, confidence_threshold=0.45, nms_threshold=0.45):
    """Detect objects in the image using ONNX model"""
    if image is None:
        return None, {}, {}

    # Preprocess the image
    blob, original_image = preprocess_image(image)
    
    # Run inference
    session = onnxruntime.InferenceSession(
        MODEL_PATH, providers=['CPUExecutionProvider']
    )
    input_name = session.get_inputs()[0].name
    output_names = [output.name for output in session.get_outputs()]
    outputs = session.run(output_names, {input_name: blob})
    
    # Process the output
    boxes = []
    confidences = []
    class_ids = []
    
    # YOLOv5m ONNX output shape is (1, 25200, 85) where:
    # 25200 is the number of predictions
    # 85 = 4 (bbox coords) + 1 (objectness) + 80 (class scores for COCO)
    predictions = outputs[0]
    
    # Get image dimensions
    img_height, img_width = original_image.shape[:2]
    
    # Scale factors
    x_factor = img_width / INPUT_WIDTH
    y_factor = img_height / INPUT_HEIGHT
    
    for prediction in predictions[0]:
        confidence = prediction[4]
        
        if confidence >= confidence_threshold:
            # Get class scores
            class_scores = prediction[5:]
            # Get the class ID with the highest score
            class_id = np.argmax(class_scores)
            # Check if the class confidence is above threshold
            if class_scores[class_id] > confidence_threshold:
                # YOLO format is center_x, center_y, width, height
                cx, cy, w, h = prediction[0:4]
                
                # Convert to top-left corner for cv2.rectangle
                left = int((cx - w/2) * x_factor)
                top = int((cy - h/2) * y_factor)
                width = int(w * x_factor)
                height = int(h * y_factor)
                
                # Add to lists
                boxes.append([left, top, width, height])
                confidences.append(float(confidence))
                class_ids.append(class_id)
    
    # Apply non-maximum suppression
    indices = cv2.dnn.NMSBoxes(
        boxes, confidences, confidence_threshold, nms_threshold
    )
    
    # Draw the bounding boxes and labels
    result_image = original_image.copy()
    
    # Dictionary to track detected objects and confidences
    detected_objects_count = {}
    detected_objects_confidences = {}
    
    # If no results, return original image and empty dictionaries
    if len(indices) == 0:
        return result_image, detected_objects_count, detected_objects_confidences
        
    for i in indices:
        # For newer versions of OpenCV, indices is a flat array
        if isinstance(i, (list, tuple)):
            i = i[0]  # For older OpenCV versions
            
        box = boxes[i]
        left = box[0]
        top = box[1]
        width = box[2]
        height = box[3]
        
        # Get the confidence value
        confidence_value = confidences[i]
        
        # Get the class name
        class_name = CLASSES[class_ids[i]]
        
        # Update the count for this class
        if class_name in detected_objects_count:
            detected_objects_count[class_name] += 1
            detected_objects_confidences[class_name].append(confidence_value)
        else:
            detected_objects_count[class_name] = 1
            detected_objects_confidences[class_name] = [confidence_value]
        
        # Draw bounding box
        color = COLORS[class_ids[i]].tolist()
        cv2.rectangle(
            result_image, (left, top), 
            (left + width, top + height), color, 2
        )
        
        label = f"{class_name} {confidences[i]:.2f}"
        
        # Text position and size calculation
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.4
        font_thickness = 1
        
        # Calculate text size
        (text_width, text_height), baseline = cv2.getTextSize(
            label, font, font_scale, font_thickness
        )
        
        # Adjust text position if close to image top
        MARGIN = 5  # Margin setting
        
        # If top is less than text height + baseline + margin, place text below box
        if top < (text_height + baseline + MARGIN):
            text_pos_x = left
            text_pos_y = top + height + text_height + MARGIN
        else:
            text_pos_x = left
            text_pos_y = top - MARGIN
        
        # Draw text background
        text_bg_left = text_pos_x
        text_bg_top = text_pos_y - text_height - baseline
        text_bg_right = text_pos_x + text_width
        text_bg_bottom = text_pos_y + baseline
        
        # Draw text background rectangle (same color as bounding box)
        cv2.rectangle(
            result_image, 
            (text_bg_left, text_bg_top), 
            (text_bg_right, text_bg_bottom), 
            color, 
            -1
        )
        
        # Draw text in white
        cv2.putText(
            result_image, 
            label, 
            (text_pos_x, text_pos_y), 
            font, 
            font_scale, 
            (255, 255, 255),
            font_thickness, 
            cv2.LINE_AA
        )
    
    return result_image, detected_objects_count, detected_objects_confidences


def log_user_activity(username, detected_objects=None):
    """Log user activity to a JSON file"""
    timestamp = datetime.now().isoformat()
    log_entry = {
        "username": username,
        "timestamp": timestamp,
        "ip_address": gr.request.client.host if hasattr(gr, "request") else "unknown"
    }
    
    # Add detected objects if available
    if detected_objects:
        # Add object count and class information
        total_count = sum(detected_objects.values())
        log_entry["total_detected_objects"] = total_count
        log_entry["detected_objects"] = detected_objects
    
    # Check if log file exists
    if os.path.exists(USER_LOG_FILE):
        with open(USER_LOG_FILE, 'r') as f:
            try:
                logs = json.load(f)
            except json.JSONDecodeError:
                logs = []
    else:
        logs = []
    
    # Append new log entry
    logs.append(log_entry)
    
    # Write back to file
    with open(USER_LOG_FILE, 'w') as f:
        json.dump(logs, f, indent=2)
    
    logger.info(f"User activity logged: {username} at {timestamp}")
    if detected_objects:
        logger.info(
            f"Detected objects: {detected_objects}, "
            f"Total: {sum(detected_objects.values())}"
        )


def validate_username(username):
    """Validate that username is not empty or just whitespace"""
    if not username or not username.strip():
        return False, "Username is required. Cannot be just whitespace."
    return True, None


def get_recent_activities(max_entries=10):
    """
    Get the most recent user activities from the log file
    Returns a pandas DataFrame for Gradio Dataframe component
    """
    if not os.path.exists(USER_LOG_FILE):
        # Return empty DataFrame instead of None for consistency
        return pd.DataFrame(columns=["Username", "Time"])
    
    try:
        with open(USER_LOG_FILE, 'r') as f:
            try:
                logs = json.load(f)
            except json.JSONDecodeError:
                logger.error("Error decoding JSON file. Returning empty DataFrame.")
                return pd.DataFrame(columns=["Username", "Time"])
            
        if not logs:
            # Return empty DataFrame with headers only if no logs
            return pd.DataFrame(columns=["Username", "Time"])
            
        # Sort by most recent activity (newest first)
        sorted_logs = sorted(
            logs, key=lambda x: x.get('timestamp', ''), reverse=True
        )
        
        # Display only up to max_entries
        recent_logs = sorted_logs[:max_entries]
        
        # Prepare data for DataFrame
        data = []
        for log in recent_logs:
            username = log.get('username', 'Unknown')
            timestamp_str = log.get('timestamp', '')
            
            # Format timestamp
            try:
                timestamp = datetime.fromisoformat(timestamp_str)
                formatted_time = timestamp.strftime('%Y-%m-%d %H:%M:%S')
            except (ValueError, TypeError):
                formatted_time = timestamp_str
                
            data.append([username, formatted_time])
            
        # Create DataFrame
        df = pd.DataFrame(data, columns=["Username", "Time"])
        return df
        
    except Exception as e:
        logger.error(f"Error getting recent activities: {e}")
        # Return empty DataFrame on error
        return pd.DataFrame(columns=["Username", "Time"])


def process_image(username, input_image, confidence_threshold=0.45, 
                  nms_threshold=0.45):
    """Gradio interface function"""
    # Validate username
    is_valid, error_msg = validate_username(username)
    if not is_valid:
        return None, None, error_msg, get_recent_activities()

    if input_image is None:
        return None, None, "An image is required.", get_recent_activities()

    # Debug information output
    logger.info(f"Received input_image type: {type(input_image)}")
    logger.info(
        f"Confidence threshold: {confidence_threshold}, "
        f"NMS threshold: {nms_threshold}"
    )
    
    if isinstance(input_image, str):
        logger.info(f"Input image path: {input_image}")
        # Check if file exists
        if not os.path.exists(input_image):
            logger.error(f"File not found: {input_image}")
            return (None, None, 
                    f"Error: File not found at {input_image}", 
                    get_recent_activities())
        
        # Check file information
        try:
            file_size = os.path.getsize(input_image)
            file_perm = oct(os.stat(input_image).st_mode)[-3:]
            logger.info(f"File size: {file_size} bytes, permissions: {file_perm}")
        except Exception as e:
            logger.error(f"Error checking file info: {e}")

    try:
        # Process the image
        result = detect_objects(
            input_image, 
            confidence_threshold, 
            nms_threshold
        )
        result_image, detected_objects_count, detected_objects_confidences = result

        # Format detected objects for JSON component
        detection_json = {}
        
        if detected_objects_count:
            # Add total count
            total_count = sum(detected_objects_count.values())
            detection_json["Total Objects Detected"] = total_count
            
            # Add count by object class with confidence statistics
            objects_dict = {}
            for obj_class, count in sorted(
                detected_objects_count.items(), 
                key=lambda x: x[1], reverse=True
            ):
                # Calculate confidence statistics
                confidences = detected_objects_confidences[obj_class]
                
                # Calculate statistics (average, min, max)
                avg_conf = sum(confidences) / len(confidences)
                min_conf = min(confidences)
                max_conf = max(confidences)
                
                # Round to 2 decimal places for better display
                avg_conf = round(avg_conf, 2)
                min_conf = round(min_conf, 2)
                max_conf = round(max_conf, 2)
                
                # Store object count and confidence statistics
                objects_dict[f"{obj_class}"] = {
                    "Count": count,
                    "Confidence Stats": {
                        "Average": avg_conf,
                        "Min": min_conf,
                        "Max": max_conf
                    }
                }
                
            detection_json["Detected Objects List"] = objects_dict
        else:
            detection_json = {"Notice": "No objects detected"}

        # Extract detected objects for logging
        log_user_activity(username, detected_objects_count)

        # Get recent activities (after log update)
        recent_activities = get_recent_activities()

        return result_image, detection_json, None, recent_activities
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        logger.error(f"Error processing image: {e}\n{error_traceback}")
        return (None, None, 
                f"Error processing image: {str(e)}", 
                get_recent_activities())


def create_interface():
    """Create and configure the Gradio interface"""
    with gr.Blocks(title="Object Detection with User Tracking") as iface:
        gr.Markdown("# Object Detection with ONNX Runtime")
        gr.Markdown("Upload an image to detect objects using YOLOv5m.")
        
        with gr.Row():
            with gr.Column():
                image_input = gr.Image(type="pil", label="Input Image")
                
                with gr.Row():
                    confidence_slider = gr.Slider(
                        minimum=0.1, 
                        maximum=1.0, 
                        value=0.45, 
                        step=0.05,
                        label="Confidence Threshold",
                        info="Set detection confidence threshold"
                    )
                    
                    nms_slider = gr.Slider(
                        minimum=0.1, 
                        maximum=1.0, 
                        value=0.45, 
                        step=0.05,
                        label="NMS Threshold",
                        info="Set Non-Maximum Suppression threshold"
                    )
                
                username_input = gr.Textbox(
                    label="Username",
                    placeholder="Enter your name",
                    info="Required for user tracking"
                )
                    
                submit_btn = gr.Button("Run Detection", variant="primary")
            
            with gr.Column():
                image_output = gr.Image(label="Detection Results")
                
                detection_json_output = gr.JSON(
                    label="Detected Objects Summary",
                    visible=True
                )
                
                error_output = gr.Textbox(
                    label="Error Message", 
                    visible=True
                )
        
        # Recent activities display area
        gr.Markdown("## Recent User Activities")
        
        # Initialize with an empty DataFrame
        recent_activities_df = gr.Dataframe(
            value=None,
            datatype=["str", "str"],
            row_count=(10, "fixed"),
            col_count=(2, "fixed"),
            interactive=False,
            wrap=True
        )
        
        # Connect the button to its function
        submit_btn.click(
            fn=process_image,
            inputs=[
                username_input, 
                image_input, 
                confidence_slider, 
                nms_slider
            ],
            outputs=[
                image_output, 
                detection_json_output, 
                error_output, 
                recent_activities_df
            ]
        )
        
        # Load recent activities when the page loads
        iface.load(
            fn=get_recent_activities,
            inputs=None,
            outputs=recent_activities_df
        )
    
    return iface


if __name__ == "__main__":
    # Ensure model is available
    ensure_model_exists()
    
    logger.info(f"Starting Gradio server on port {server_port}")
    logger.info(f"Current working directory: {os.getcwd()}")
    
    # Create and launch the interface
    iface = create_interface()
    iface.launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False,
        show_error=True,
        favicon_path=None
    ) 
