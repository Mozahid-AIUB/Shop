-- Parcel weight, and somewhere to keep an OAuth token.
--
-- Couriers require a weight and charge by it, so a wrong weight means a wrong
-- bill. It lives on the variant, not the product, because weight changes with
-- the variant: an XL shirt weighs more than an S, a 500ml bottle less than a 1L.
--
-- Grams, as an integer, for the same reason money is in paisa: RedX wants grams
-- and Pathao wants kilograms as a float, so storing grams lets each adapter
-- divide as it needs without float arithmetic creeping into a billed quantity.
--
-- NULL means nobody filled it in, and the courier account's default is used.
-- Zero is not allowed: it would read as a weightless parcel, and couriers
-- refuse one.
--
-- oauthToken holds Pathao-style credentials that expire (5 days). Asking for a
-- fresh token on every call would hit their rate limit, and keeping it in
-- memory would lose it on every restart -- with more than one server, each
-- would hold its own. It is encrypted like the API keys, because a live token
-- does the same job as a key until it expires.


-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "weightGrams" INTEGER;

-- AlterTable
ALTER TABLE "courier_accounts" ADD COLUMN     "defaultWeightGrams" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "oauthToken" TEXT;

