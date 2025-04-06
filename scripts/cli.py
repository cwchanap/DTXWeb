import click
import os
import json
from dotenv import load_dotenv
from supabase import create_client, Client
import boto3

load_dotenv()

TITLE_FOLDER_MAP = json.load(open("title_folder_map.json"))

@click.group()
def cli():
    ...

@cli.command()
def patch():
    url: str = os.environ.get("SUPABASE_URL")
    key: str = os.environ.get("SUPABASE_KEY")
    dtx_directory: str = os.environ.get("DTX_DIRECTORY")
    supabase: Client = create_client(url, key)

    response = supabase.table("simfiles").select("id, title, preview_url, sound_preview_url").is_(
        "sound_preview_url", None
    ).execute()
    data = response.data

    for file in data:
        title = file["title"].strip()
        sound_preview_url = file["sound_preview_url"]   
        preview_url = file["preview_url"]
        print("Title: ", title)

        # Case-insensitive search for the folder
        folder = os.path.join(dtx_directory, title)
        if os.path.isdir(folder):
            print("Found Folder: ", folder)
        else:
            # Search for the folder case-insensitively
            folder = None
            for dir_name in os.listdir(dtx_directory):
                if dir_name.lower() == title.lower():
                    folder = os.path.join(dtx_directory, dir_name)
                    break
            if folder:
                print("Found Folder: ", folder)
            else:
                folder = os.path.join(dtx_directory, TITLE_FOLDER_MAP.get(title, title))
                if not os.path.isdir(folder):
                    print("Folder not found: ", folder)
                    continue

        sound_file = os.path.join(folder, "preview.mp3")

        if os.path.exists(sound_file):
            print("Sound file found: ", sound_file)
            supabase_path = preview_url.replace("jpg", "mp3")
            with open(sound_file, 'rb') as f:
                supabase.storage.from_(
                "simfile-sound-previews"
            ).upload(file=f, path=supabase_path, file_options={"content-type": "audio/mpeg"})

            supabase.table("simfiles").update(
                {"sound_preview_url": supabase_path}
            ).eq("id", file["id"]).execute()
            print("Updated sound_preview_url: ", supabase_path)
        else:
            print("Sound file not found.")
            continue

@cli.command()
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
