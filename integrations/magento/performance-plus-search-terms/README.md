# PerformancePlus_SearchTerms

Magento 2 module that exposes the internal `search_query` table to Performance+ through a small authenticated Web API endpoint.

## Endpoint

`GET /rest/<store_code>/V1/performance-plus/search-terms?limit=100`

Response:

```json
{
  "items": [
    {
      "query_text": "safety shoes",
      "popularity": 42,
      "num_results": 12
    }
  ]
}
```

## Install

Copy the `PerformancePlus/SearchTerms` folder to:

`app/code/PerformancePlus/SearchTerms`

Then run:

```bash
php bin/magento module:enable PerformancePlus_SearchTerms
php bin/magento setup:upgrade
php bin/magento cache:flush
```

## Integration Permissions

In Magento Admin, update the Performance+ integration permissions and include:

`System > Extensions > Integrations > Performance+ Search Terms`

Then re-activate the integration and paste the new Access Token into Performance+ if Magento regenerated it.
