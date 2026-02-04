import click
import os
from dotenv import load_dotenv
import boto3

load_dotenv()

@click.group()
def cli():
    ...

@click.command()
@click.argument('input_path')
@click.argument('destination', required=False)
def upload_r2(input_path, destination):
    """
    Upload a file to Cloudflare R2 bucket.

    destination format: <bucket_name>:<remote_path>
    If omitted, defaults to 'drumery:<input_path>'
    """
    # Load credentials from environment
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    access_key_id = os.getenv("CLOUDFLARE_ACCESS_KEY_ID")
    access_key_secret = os.getenv("CLOUDFLARE_ACCESS_KEY_SECRET")

    if not all([account_id, access_key_id, access_key_secret]):
        print("Missing Cloudflare R2 credentials in environment variables.")
        return

    # Parse destination argument
    if destination:
        if ':' in destination:
            bucket_name, remote_path = destination.split(':', 1)
        else:
            print("Invalid destination format. Use <bucket_name>:<remote_path>")
            return
    else:
        bucket_name = "drumery"
        remote_path = input_path

    # Setup boto3 client for R2
    endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
    s3 = boto3.client(
        "s3",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=access_key_secret,
        endpoint_url=endpoint_url,
    )

    try:
        with open(input_path, "rb") as f:
            s3.upload_fileobj(f, bucket_name, remote_path)
        print(f"Uploaded {input_path} to R2 bucket '{bucket_name}' at '{remote_path}'")
    except Exception as e:
        print(f"Failed to upload: {e}")

if __name__ == "__main__":
    cli()
