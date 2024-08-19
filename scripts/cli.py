import click
import supabase
import os
from dotenv import load_dotenv
from supabase import create_client, Client

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

if __name__ == "__main__":
    cli()