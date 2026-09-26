FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
# CPU-only torch keeps the image small; training can also run on the host.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8200
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8200"]
