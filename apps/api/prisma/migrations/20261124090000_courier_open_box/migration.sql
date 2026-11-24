-- Whether the customer may open a parcel before paying.
--
-- The right answer depends on what is being sold, so it belongs to the admin
-- rather than the code. Electronics need inspection -- nobody hands over
-- fifteen thousand taka sight unseen. Custom-printed goods are the opposite: a
-- "changed my mind" refusal after opening leaves stock that cannot be sold to
-- anyone else. Sealed food and cosmetics are the same.
--
-- Defaults to true, because inspection is right for most shops and a new shop's
-- hardest problem is being trusted at the door.
--
-- Only RedX's API exposes this switch today; the other adapters ignore it.


-- AlterTable
ALTER TABLE "courier_accounts" ADD COLUMN     "allowOpenBox" BOOLEAN NOT NULL DEFAULT true;

