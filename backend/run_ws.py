
import asyncio
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

async def main():
    try:
        from app.services.torn_websocket import torn_websocket_service
        await torn_websocket_service.run()
    except KeyboardInterrupt:
        logger.info("Stopping WebSocket Service...")
    except Exception as e:
        logger.critical(f"WebSocket Service failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    # Ensure current directory is in python path
    import os
    sys.path.append(os.getcwd())
    
    asyncio.run(main())
